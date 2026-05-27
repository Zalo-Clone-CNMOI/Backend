import { Inject, Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { CacheService } from '@libs/redis';
import { AiCoreClientService } from '@app/clients';
import { hashMessageBody } from '@libs/shared';
import { ConversationType } from '@app/constant';
import type {
  ChatMessageRejectedEvent,
  ModerationLabelType,
} from '@libs/contracts';
import {
  FailOpenReason,
  PreSendModerationMetricsService,
  PreSendModerationOutcome,
} from './pre-send-moderation.metrics';

/**
 * Returned to SendMessageHandler when a message must be blocked.
 * NOT a wire contract — bodyHash is scoped to chat-service (audit log
 * correlation), never sent to FE or other services.
 */
export interface RejectionInfo {
  reason: ChatMessageRejectedEvent['reason'];
  labels: ModerationLabelType[];
  confidence: number;
  bodyHash: string;
}

/** Internal-only minimum length under which we cache (clean OR block). */
const CACHE_POPULATE_MAX_LEN = 500;

/** Confidence floor for cache population (regardless of clean or block). */
const CACHE_POPULATE_MIN_CONFIDENCE = 0.95;

@Injectable()
export class PreSendModerationService {
  private readonly logger = new Logger(PreSendModerationService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly aiCoreClient: AiCoreClientService,
    private readonly metrics: PreSendModerationMetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Returns null = allowed; otherwise the rejection metadata that
   * SendMessageHandler emits as ChatMessageRejected + writes to the audit log.
   *
   * Always fail-open: any error / timeout → null with warn log + metric.
   *
   * Threshold semantics: a flagged result with `confidence < threshold`
   * (default 0.85) is treated as ALLOW. Only `is_flagged && confidence >=
   * threshold` blocks. This is the ONLY place in the codebase threshold
   * logic lives — the HTTP endpoint and cache layer pass verdicts
   * through verbatim.
   */
  /**
   * Coerce the generated client's ModerationLabel enum array to the
   * @libs/contracts ModerationLabelType union. Runtime values are
   * identical ('clean' | 'toxic' | …); this is a typing-only adapter at
   * the cluster-internal boundary.
   */
  private coerceLabels(labels: unknown[]): ModerationLabelType[] {
    return labels as ModerationLabelType[];
  }

  async checkOrAllow(input: {
    senderId: string;
    conversationId: string;
    body: string;
    conversationType: ConversationType | null;
    traceId: string;
  }): Promise<RejectionInfo | null> {
    const convTypeLabel: ConversationType | 'unknown' =
      input.conversationType ?? 'unknown';

    // 1. Master flag.
    if (!this.config.chatPreSendModerationEnabled) {
      this.metrics.recordOutcome('disabled', convTypeLabel);
      return null;
    }

    // 2. Per-conversation-type skip list. Uses enum constants — TypeScript
    //    will fail compilation if the enum changes shape, preventing a
    //    silent string-casing bypass.
    const skipList = this.config.chatPreSendModerationSkipConvTypes ?? [
      ConversationType.DIRECT,
      ConversationType.AI_ASSISTANT,
    ];
    if (
      input.conversationType !== null &&
      skipList.includes(input.conversationType)
    ) {
      this.metrics.recordOutcome('skipped_conv_type', convTypeLabel);
      return null;
    }

    const bodyHash = hashMessageBody(input.body);

    // 3. Cache fast-path.
    const cached = await this.cacheService.getModerationFastResult(bodyHash);
    if (cached) {
      const threshold = this.threshold;
      if (!cached.is_flagged) {
        this.metrics.recordOutcome('cache_hit_clean', convTypeLabel);
        return null;
      }
      if (cached.confidence >= threshold) {
        this.metrics.recordOutcome('cache_hit_block', convTypeLabel);
        return {
          reason: 'moderation',
          labels: cached.labels,
          confidence: cached.confidence,
          bodyHash,
        };
      }
      // Cached as flagged but below threshold — the gate's decision is
      // ALLOW, and no LLM was called. Reaching this branch requires the
      // threshold to have been RAISED since the cache write (cache only
      // populates flagged entries with confidence >= 0.95; default
      // threshold is 0.85). Use `cache_hit_clean` to keep metric semantics
      // consistent: the label means "cache served an allow decision",
      // regardless of how the engine originally classified it.
      this.metrics.recordOutcome('cache_hit_clean', convTypeLabel);
      return null;
    }

    // 4. LLM call.
    const startedAt = Date.now();
    let outcomeForDuration: PreSendModerationOutcome = 'allow_llm';
    try {
      const verdict = await this.aiCoreClient.checkPreSendModeration({
        body: input.body,
        senderId: input.senderId,
        conversationId: input.conversationId,
        timeoutMs: this.config.chatPreSendModerationTimeoutMs ?? 2000,
        traceId: input.traceId,
      });

      const threshold = this.threshold;

      const labels = this.coerceLabels(verdict.labels);

      // 5. Block branch.
      if (verdict.is_flagged && verdict.confidence >= threshold) {
        if (
          verdict.confidence >= CACHE_POPULATE_MIN_CONFIDENCE &&
          this.normalizedLength(input.body) < CACHE_POPULATE_MAX_LEN
        ) {
          // Short TTL — model/threshold tuning re-evaluates relatively
          // quickly; the goal is spam-retry dedupe, not permanent block.
          await this.cacheService.setModerationFastResult(
            bodyHash,
            {
              is_flagged: verdict.is_flagged,
              labels,
              confidence: verdict.confidence,
            },
            this.config.chatPreSendModerationBlockCacheTtlSeconds ?? 900,
          );
        }
        outcomeForDuration = 'block';
        this.metrics.recordOutcome('block', convTypeLabel);
        return {
          reason: 'moderation',
          labels,
          confidence: verdict.confidence,
          bodyHash,
        };
      }

      // 6. Allow branch — conditional clean-cache populate.
      if (
        !verdict.is_flagged &&
        labels.includes('clean') &&
        verdict.confidence >= CACHE_POPULATE_MIN_CONFIDENCE &&
        this.normalizedLength(input.body) < CACHE_POPULATE_MAX_LEN
      ) {
        await this.cacheService.setModerationFastResult(
          bodyHash,
          {
            is_flagged: false,
            labels,
            confidence: verdict.confidence,
          },
          this.config.chatPreSendModerationCacheTtlSeconds ?? 86400,
        );
      }

      this.metrics.recordOutcome('allow_llm', convTypeLabel);
      return null;
    } catch (err) {
      outcomeForDuration = 'fail_open';
      const reason = classifyFailOpenReason(err);
      this.metrics.recordOutcome('fail_open', convTypeLabel, reason);
      this.logger.warn(
        `[${input.traceId}] pre-send moderation fail-open: ${reason}`,
        {
          senderId: input.senderId,
          conversationId: input.conversationId,
          convType: convTypeLabel,
          bodyHash,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return null;
    } finally {
      this.metrics.observeDuration(Date.now() - startedAt, outcomeForDuration);
    }
  }

  private get threshold(): number {
    return this.config.chatPreSendModerationConfidenceThreshold ?? 0.85;
  }

  private normalizedLength(body: string): number {
    return body.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')
      .length;
  }
}

function classifyFailOpenReason(err: unknown): FailOpenReason {
  if (err && typeof err === 'object') {
    const maybeAxios = err as Partial<AxiosError>;
    if (
      maybeAxios.code === 'ECONNABORTED' ||
      (err as { name?: string }).name === 'AbortError'
    ) {
      return 'timeout';
    }
    if (maybeAxios.response) {
      return 'http_error';
    }
  }
  return 'network_error';
}
