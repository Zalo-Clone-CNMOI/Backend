import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@libs/redis';
import { MessageRepository } from '@libs/scylla';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import {
  filterMessagesForSummarization,
  parseAiSummaryJson,
  recordSummarizationMetrics,
} from '../ai-gateway/services/text-summarizer.util';
import type { AiCatchUpResultEvent } from '@libs/contracts';
import { toAiProviderType } from '@libs/contracts';
import { BusinessException } from '@app/types';
import type { PersistedMessage } from '@app/types/interfaces/chat.interface';

/** How many messages to fetch from ScyllaDB in one shot (newest-first DESC). */
const FETCH_CAP = 200;

/** Maximum messages to feed into the catch-up prompt. */
const SUMMARY_CAP = 50;

/** Redis TTL for a catch-up result (10 minutes). */
const CACHE_TTL_SECONDS = 600;

@Injectable()
export class CatchUpEngine {
  private readonly logger = new Logger(CatchUpEngine.name);

  constructor(
    private readonly messageRepo: MessageRepository,
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Summarise the unread messages in a conversation for a specific user.
   *
   * @param input.conversation_id  The conversation to inspect.
   * @param input.user_id          The requesting user (forwarded to the AI gateway for budget tracking).
   * @param input.since            Epoch-ms boundary: only messages AFTER this timestamp are
   *                               considered "unread". Omit when the user has never read the
   *                               conversation (all messages are unread).
   * @param input.limit            Caller-supplied cap for the summary window (server-side max is 50).
   * @param input.trace_id         Optional trace id propagated to the result.
   */
  async summarizeUnread(input: {
    conversation_id: string;
    user_id: string;
    since?: number;
    limit?: number;
    trace_id?: string;
  }): Promise<AiCatchUpResultEvent> {
    const { conversation_id, user_id, since, limit, trace_id } = input;

    // Effective per-request cap: caller may narrow it but never exceed SUMMARY_CAP.
    const effectiveCap =
      limit !== undefined && limit > 0
        ? Math.min(limit, SUMMARY_CAP)
        : SUMMARY_CAP;

    // ── 1. Fetch newest messages from ScyllaDB ──────────────────────────────
    let allMessages: PersistedMessage[];
    try {
      allMessages = await this.messageRepo.getAllMessages(
        conversation_id,
        FETCH_CAP,
      );
    } catch (err) {
      this.logger.error(
        `ScyllaDB fetch failed for catch-up conversation_id=${conversation_id} trace_id=${trace_id ?? 'none'}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw BusinessException.internal(
        'Upstream message store is unavailable. Please try again later.',
      );
    }

    // ── 2. Determine the unread window ──────────────────────────────────────
    // getAllMessages returns DESC (newest first). Drop deleted messages and
    // messages at/older than `since`. Body filtering happens at step 6.
    let windowDesc: PersistedMessage[] = filterMessagesForSummarization(
      allMessages,
      { since },
    );

    // ── 3. Edge case: no unread messages ───────────────────────────────────
    if (windowDesc.length === 0) {
      return {
        conversation_id,
        user_id,
        had_unread: false,
        summary: '',
        message_count: 0,
        since,
        truncated: false,
        provider: 'openai',
        tokens_used: 0,
        cached: false,
        generated_at: Date.now(),
        trace_id,
      };
    }

    // ── 4. Truncation ───────────────────────────────────────────────────────
    const truncated = windowDesc.length > effectiveCap;
    if (truncated) {
      // Keep only the newest `effectiveCap` (still DESC) then convert to ASC below.
      windowDesc = windowDesc.slice(0, effectiveCap);
    }

    // Reverse to chronological order (oldest → newest) for the prompt.
    const windowAsc = [...windowDesc].reverse();

    const fromMessageId = windowAsc[0].message_id;
    const toMessageId = windowAsc[windowAsc.length - 1].message_id;
    const messageCount = windowAsc.length;

    // ── 5. Check Redis cache ────────────────────────────────────────────────
    // effectiveCap is part of the key: two requests ending at the same message
    // but with different caps can differ in message_count/truncated.
    const cacheKey = `ai:catchup:${conversation_id}:${since ?? 'none'}:${toMessageId}:${effectiveCap}`;

    let cachedRaw: string | null = null;
    try {
      cachedRaw = await this.redis.get(cacheKey);
    } catch (cacheReadErr) {
      this.logger.warn(
        `Catch-up cache read failed (Redis unavailable): ${cacheReadErr instanceof Error ? cacheReadErr.message : String(cacheReadErr)}`,
      );
    }
    if (cachedRaw) {
      try {
        const hit = JSON.parse(cachedRaw) as AiCatchUpResultEvent;
        // I1: Override identity fields so the cached content is attributed to
        // the CURRENT caller, not the original requester.
        return { ...hit, cached: true, user_id, trace_id };
      } catch {
        this.logger.warn(
          `Corrupt catch-up cache for conversation ${conversation_id} — regenerating`,
        );
      }
    }

    // ── 6. Build prompt lines ───────────────────────────────────────────────
    // I2: Only messages that have a text body are fed to the LLM.
    const lines: string[] = filterMessagesForSummarization(windowAsc, {
      requireBody: true,
    }).map((m) => m.body);

    // I2: Short-circuit when all unread messages are media-only (no body text).
    if (lines.length === 0) {
      return {
        conversation_id,
        user_id,
        had_unread: false,
        summary: '',
        message_count: 0,
        since,
        truncated: false,
        provider: 'unknown',
        tokens_used: 0,
        cached: false,
        generated_at: Date.now(),
        trace_id,
      };
    }

    // ── 7. Call AI gateway ──────────────────────────────────────────────────
    const messages = this.promptBuilder.buildCatchUpPrompt(lines);

    try {
      const result = await this.gateway.complete(user_id, {
        messages,
        maxTokens: 400,
        temperature: 0.3,
      });

      const { summary } = parseAiSummaryJson(result.content);

      // I3: Record metrics on success path.
      recordSummarizationMetrics(this.aiMetrics, 'catch_up', result);

      // ── 8. Build result ─────────────────────────────────────────────────────
      const catchUpResult: AiCatchUpResultEvent = {
        conversation_id,
        user_id,
        had_unread: true,
        summary,
        message_count: messageCount,
        from_message_id: fromMessageId,
        to_message_id: toMessageId,
        since,
        truncated,
        provider: toAiProviderType(result.provider),
        tokens_used: result.tokensIn + result.tokensOut,
        cached: false,
        generated_at: Date.now(),
        trace_id,
      };

      // ── 9. Store in Redis cache ─────────────────────────────────────────────
      try {
        await this.redis.setEx(
          cacheKey,
          CACHE_TTL_SECONDS,
          JSON.stringify(catchUpResult),
        );
      } catch (cacheErr) {
        this.logger.warn(
          `Catch-up cache write failed (Redis unavailable): ${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}`,
        );
      }

      return catchUpResult;
    } catch (error) {
      // C2: Gateway failure — log, record failure metric, return graceful fallback.
      this.logger.error(
        `Catch-up AI gateway failed for conversation_id=${conversation_id} trace_id=${trace_id ?? 'none'}: ${error instanceof Error ? error.message : String(error)}`,
      );

      // I3: Record metrics on failure path.
      recordSummarizationMetrics(this.aiMetrics, 'catch_up', null);

      return {
        conversation_id,
        user_id,
        had_unread: true,
        summary:
          'Could not generate your catch-up summary right now. Please try again later.',
        message_count: messageCount,
        from_message_id: fromMessageId,
        to_message_id: toMessageId,
        since,
        truncated,
        provider: 'unknown',
        tokens_used: 0,
        cached: false,
        generated_at: Date.now(),
        trace_id,
      };
    }
  }
}
