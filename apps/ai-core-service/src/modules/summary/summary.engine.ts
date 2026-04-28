import { Injectable, Logger, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { RedisService } from '@libs/redis';
import { MessageRepository } from '@libs/scylla';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { parseJsonResponse } from '../ai-gateway/services/parse-json.util';
import type {
  AiSummaryRequestEvent,
  AiSummaryResultEvent,
} from '@libs/contracts';
import { toAiProviderType } from '@libs/contracts';
import type { PersistedMessage } from '@app/types/interfaces/chat.interface';

const MESSAGES_FETCH_LIMIT = 100;
const INCREMENTAL_MIN_NEW_MESSAGES = 3;

interface CachedSummaryPayload {
  conversation_id: string;
  summary: string;
  message_range: {
    from_message_id: string;
    to_message_id: string;
    count: number;
  };
  provider: string;
  tokens_used: number;
}

@Injectable()
export class SummaryEngine {
  private readonly logger = new Logger(SummaryEngine.name);
  private readonly cacheEnabled: boolean;
  private readonly CACHE_TTL = 3600;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
    private readonly redis: RedisService,
    private readonly messageRepo: MessageRepository,
  ) {
    this.cacheEnabled = config.aiEnableConversationCache !== false;
  }

  async summarize(
    event: AiSummaryRequestEvent,
    messages: string[],
  ): Promise<AiSummaryResultEvent> {
    const cacheKey = `ai:summary:${event.conversation_id}`;

    // --- Check cache ---
    let cached: CachedSummaryPayload | null = null;
    if (this.cacheEnabled) {
      const raw = await this.redis.get(cacheKey);
      if (raw) {
        try {
          cached = JSON.parse(raw) as CachedSummaryPayload;
        } catch {
          this.logger.warn(`Invalid cached summary for ${event.conversation_id}`);
        }
      }
    }

    // --- Fetch messages from ScyllaDB if caller didn't provide them ---
    // getAllMessages returns DESC (newest first)
    const allDbMessages: PersistedMessage[] | null =
      messages.length === 0
        ? await this.messageRepo.getAllMessages(
            event.conversation_id,
            MESSAGES_FETCH_LIMIT,
          )
        : null;

    // --- Incremental path: cache exists + we have DB messages ---
    if (cached && allDbMessages) {
      const toId = cached.message_range.to_message_id;
      const cutIdx = allDbMessages.findIndex((m) => m.message_id === toId);

      if (cutIdx === -1) {
        if (allDbMessages.length === 0) {
          // DB returned nothing → no new content; return cached unchanged
          return {
            ...cached,
            provider: toAiProviderType(cached.provider),
            user_id: event.user_id,
            cached: true,
            processed_at: Date.now(),
            trace_id: event.trace_id,
          };
        }

        const summaryLines = allDbMessages
          .filter((m) => !m.deleted_at && m.body)
          .reverse()
          .map((m) => m.body);

        if (summaryLines.length === 0) {
          // All messages in the DB window are soft-deleted; return the existing cache rather than
          // discarding a valid prior summary.
          return {
            ...cached,
            provider: toAiProviderType(cached.provider),
            user_id: event.user_id,
            cached: true,
            processed_at: Date.now(),
            trace_id: event.trace_id,
          };
        }

        // Anchor not in last MESSAGES_FETCH_LIMIT messages → conversation outpaced the window;
        // fall back to full re-summarization to avoid silently returning stale content.
        this.logger.warn(
          `Cache anchor ${toId} not found in last ${MESSAGES_FETCH_LIMIT} messages for ${event.conversation_id} — falling back to full summarization`,
        );
        const dbMsgIds = allDbMessages
          .filter((m) => !m.deleted_at && m.body)
          .map((m) => m.message_id);
        const fromId = dbMsgIds[dbMsgIds.length - 1] ?? 'unknown';
        const newToId = dbMsgIds[0] ?? 'unknown';
        return this.runFullSummary(event, summaryLines, fromId, newToId, cacheKey);
      }

      // Messages at indices 0..cutIdx-1 are newer than the cached summary (DESC order)
      const newRawMessages = allDbMessages.slice(0, cutIdx);

      const newMessages = newRawMessages
        .filter((m) => !m.deleted_at && m.body)
        .reverse() // chronological order
        .map((m) => m.body);

      if (newMessages.length < INCREMENTAL_MIN_NEW_MESSAGES) {
        // Not enough new content → return cached
        return {
          ...cached,
          provider: toAiProviderType(cached.provider),
          user_id: event.user_id,
          cached: true,
          processed_at: Date.now(),
          trace_id: event.trace_id,
        };
      }

      // Enough new messages → incremental update
      return this.runIncremental(event, cached, newMessages, allDbMessages, cacheKey);
    }

    // --- Full summarization path ---
    const summaryLines: string[] =
      messages.length > 0
        ? messages
        : (allDbMessages ?? [])
            .filter((m) => !m.deleted_at && m.body)
            .reverse()
            .map((m) => m.body);

    if (summaryLines.length === 0) {
      return this.emptySummaryResult(event);
    }

    const dbMsgIds =
      allDbMessages
        ?.filter((m) => !m.deleted_at && m.body)
        .map((m) => m.message_id) ?? [];

    if (messages.length > 0 && (!event.message_ids || event.message_ids.length === 0)) {
      this.logger.warn(
        `summarize called with messages but no message_ids for ${event.conversation_id} — message_range will use 'unknown' IDs`,
      );
    }

    // allDbMessages is DESC, so after filter+reverse: index 0=oldest, last=newest
    const fromId = event.message_ids?.[0] ?? dbMsgIds[dbMsgIds.length - 1] ?? 'unknown';
    const toId = event.message_ids?.[event.message_ids.length - 1] ?? dbMsgIds[0] ?? 'unknown';

    return this.runFullSummary(event, summaryLines, fromId, toId, cacheKey);
  }

  private async runFullSummary(
    event: AiSummaryRequestEvent,
    summaryLines: string[],
    fromId: string,
    toId: string,
    cacheKey: string,
  ): Promise<AiSummaryResultEvent> {
    try {
      const prompts = this.promptBuilder.buildSummaryPrompt(summaryLines);

      const result = await this.gateway.complete(event.user_id, {
        messages: prompts,
        maxTokens: 512,
        temperature: 0.3,
      });

      const { summary } = this.parseResponse(result.content);

      this.aiMetrics.recordRequest(
        'summary',
        result.provider,
        result.model,
        result.tokensIn,
        result.tokensOut,
        result.latencyMs,
        true,
      );

      const summaryResult: AiSummaryResultEvent = {
        conversation_id: event.conversation_id,
        user_id: event.user_id,
        summary,
        message_range: { from_message_id: fromId, to_message_id: toId, count: summaryLines.length },
        provider: toAiProviderType(result.provider),
        tokens_used: result.tokensIn + result.tokensOut,
        cached: false,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };

      if (this.cacheEnabled) {
        await this.redis.setEx(
          cacheKey,
          this.CACHE_TTL,
          JSON.stringify({
            conversation_id: summaryResult.conversation_id,
            summary: summaryResult.summary,
            message_range: summaryResult.message_range,
            provider: summaryResult.provider,
            tokens_used: summaryResult.tokens_used,
          }),
        );
      }

      return summaryResult;
    } catch (error) {
      this.logger.error(
        `Summary failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.aiMetrics.recordRequest('summary', 'unknown', 'unknown', 0, 0, 0, false);
      return this.errorSummaryResult(event);
    }
  }

  private async runIncremental(
    event: AiSummaryRequestEvent,
    cached: CachedSummaryPayload,
    newMessages: string[],
    allDbMessages: PersistedMessage[],
    cacheKey: string,
  ): Promise<AiSummaryResultEvent> {
    try {
      const prompts = this.promptBuilder.buildSummaryUpdatePrompt(
        cached.summary,
        newMessages,
      );

      const result = await this.gateway.complete(event.user_id, {
        messages: prompts,
        maxTokens: 512,
        temperature: 0.3,
      });

      const { summary } = this.parseResponse(result.content);

      this.aiMetrics.recordRequest(
        'summary',
        result.provider,
        result.model,
        result.tokensIn,
        result.tokensOut,
        result.latencyMs,
        true,
      );

      // New toId = newest non-deleted message (index 0 in DESC array)
      const newToId =
        allDbMessages.find((m) => !m.deleted_at && m.body)?.message_id ??
        cached.message_range.to_message_id;

      const summaryResult: AiSummaryResultEvent = {
        conversation_id: event.conversation_id,
        user_id: event.user_id,
        summary,
        message_range: {
          from_message_id: cached.message_range.from_message_id,
          to_message_id: newToId,
          count: cached.message_range.count + newMessages.length,
        },
        provider: toAiProviderType(result.provider),
        tokens_used: result.tokensIn + result.tokensOut,
        cached: false,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };

      if (this.cacheEnabled) {
        await this.redis.setEx(
          cacheKey,
          this.CACHE_TTL,
          JSON.stringify({
            conversation_id: summaryResult.conversation_id,
            summary: summaryResult.summary,
            message_range: summaryResult.message_range,
            provider: summaryResult.provider,
            tokens_used: summaryResult.tokens_used,
          }),
        );
      }

      return summaryResult;
    } catch (error) {
      this.logger.error(
        `Incremental summary failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.aiMetrics.recordRequest('summary', 'unknown', 'unknown', 0, 0, 0, false);
      return {
        ...cached,
        provider: toAiProviderType(cached.provider),
        user_id: event.user_id,
        cached: true,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    }
  }

  private emptySummaryResult(event: AiSummaryRequestEvent): AiSummaryResultEvent {
    return {
      conversation_id: event.conversation_id,
      user_id: event.user_id,
      summary: 'No messages to summarize.',
      message_range: { from_message_id: '', to_message_id: '', count: 0 },
      provider: 'openai',
      tokens_used: 0,
      cached: false,
      processed_at: Date.now(),
      trace_id: event.trace_id,
    };
  }

  private errorSummaryResult(event: AiSummaryRequestEvent): AiSummaryResultEvent {
    return {
      conversation_id: event.conversation_id,
      user_id: event.user_id,
      summary: 'Summary generation failed. Please try again later.',
      message_range: { from_message_id: '', to_message_id: '', count: 0 },
      provider: 'openai',
      tokens_used: 0,
      cached: false,
      processed_at: Date.now(),
      trace_id: event.trace_id,
    };
  }

  private parseResponse(content: string): { summary: string } {
    try {
      const json = parseJsonResponse(content) as Record<string, unknown>;
      return {
        summary: typeof json.summary === 'string' ? json.summary : content,
      };
    } catch {
      return { summary: content };
    }
  }
}
