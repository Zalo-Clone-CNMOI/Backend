import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
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
import type { LlmChatMessage } from '../ai-gateway/interfaces';
import type { PersistedMessage } from '@app/types/interfaces/chat.interface';

/** Default trigger when config omits it. */
const DEFAULT_TRIGGER_TURNS = 30;
/** How many messages to pull from ScyllaDB when building the L2 summary. */
const L2_FETCH_LIMIT = 200;
/** Rolling-summary cache TTL (1h) — short enough to stay roughly fresh. */
const L2_CACHE_TTL_SECONDS = 3600;

/**
 * Zai L2 rolling-summary memory (Phase 6 C8). FEATURE-FLAGGED OFF by default.
 *
 * The engine keeps the most-recent turns verbatim (the L1 window). When
 * enabled AND the conversation is longer than the trigger, this service
 * summarizes the turns OLDER than the L1 window into a single rolling system
 * message, prepended to the L1 window. Disabled → exact no-op: returns the L1
 * history untouched with zero extra I/O, preserving current behaviour.
 *
 * Flag stays OFF in prod until telemetry shows >trigger-turn conversations are
 * common, honouring the memory-layer escalation policy.
 */
@Injectable()
export class ZaiMemoryService {
  private readonly logger = new Logger(ZaiMemoryService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly messageRepo: MessageRepository,
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Prepend a rolling summary of older turns to the L1 history window when the
   * feature is enabled and the conversation is long enough. Otherwise returns
   * `l1History` unchanged.
   */
  async withRollingSummary(
    conversationId: string,
    userId: string,
    l1History: LlmChatMessage[],
    traceId?: string,
  ): Promise<LlmChatMessage[]> {
    if (this.config.zaiL2MemoryEnabled !== true) {
      return l1History; // no-op, zero I/O
    }

    const triggerTurns =
      this.config.zaiL2SummaryTriggerTurns ?? DEFAULT_TRIGGER_TURNS;

    let older: PersistedMessage[];
    try {
      const fetched = await this.messageRepo.getAllMessages(
        conversationId,
        L2_FETCH_LIMIT,
      );
      const filteredDesc = filterMessagesForSummarization(fetched, {
        requireBody: true,
      });
      // Not enough total history to be worth a second memory layer.
      if (filteredDesc.length <= triggerTurns) {
        return l1History;
      }
      // filteredDesc is DESC (newest first). Skip the most-recent L1 turns
      // (kept verbatim by the engine) and summarize the older remainder.
      older = filteredDesc.slice(l1History.length);
    } catch (err) {
      this.logger.warn(
        `[${traceId ?? 'none'}] L2 history fetch failed for ${conversationId}; using pure L1`,
        err,
      );
      return l1History;
    }

    if (older.length === 0) {
      return l1History;
    }

    const summary = await this.buildOrReuseSummary(
      conversationId,
      userId,
      older,
      traceId,
    );
    if (!summary) {
      return l1History; // summarization failed — fail safe to pure L1
    }

    return [
      {
        role: 'system',
        content: `Summary of earlier conversation (older than the recent messages):\n${summary}`,
      },
      ...l1History,
    ];
  }

  /**
   * Return a cached rolling summary if present, else generate one from the
   * older window and cache it. Returns null on summarization failure.
   */
  private async buildOrReuseSummary(
    conversationId: string,
    userId: string,
    olderDesc: PersistedMessage[],
    traceId?: string,
  ): Promise<string | null> {
    const cacheKey = `zai:l2:${conversationId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (err) {
      this.logger.warn(
        `[${traceId ?? 'none'}] L2 cache read failed for ${conversationId}`,
        err,
      );
      // fall through to regenerate
    }

    // Chronological order (oldest → newest) for the summary prompt.
    const lines = [...olderDesc].reverse().map((m) => m.body);

    try {
      const prompts = this.promptBuilder.buildSummaryPrompt(lines);
      const result = await this.gateway.complete(userId, {
        messages: prompts,
        maxTokens: 512,
        temperature: 0.3,
      });
      const { summary } = parseAiSummaryJson(result.content);
      recordSummarizationMetrics(this.aiMetrics, 'zai_l2_memory', result);

      try {
        await this.redis.setEx(cacheKey, L2_CACHE_TTL_SECONDS, summary);
      } catch (cacheErr) {
        this.logger.warn(
          `[${traceId ?? 'none'}] L2 cache write failed for ${conversationId}`,
          cacheErr,
        );
      }

      return summary;
    } catch (err) {
      recordSummarizationMetrics(this.aiMetrics, 'zai_l2_memory', null);
      this.logger.error(
        `[${traceId ?? 'none'}] L2 summarization failed for ${conversationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
