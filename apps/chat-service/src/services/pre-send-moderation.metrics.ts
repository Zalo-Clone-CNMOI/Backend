import { Injectable, Logger } from '@nestjs/common';
import { MetricsService } from '@libs/metrics';
import { ConversationType } from '@app/constant';
import { Counter, Histogram } from 'prom-client';

/**
 * Outcome label for the pre-send moderation gate. Every call to
 * PreSendModerationService.checkOrAllow emits exactly one of these.
 */
export type PreSendModerationOutcome =
  | 'disabled' // master flag off
  | 'skipped_conv_type' // DIRECT / AI_ASSISTANT (or env-configured skip)
  | 'cache_hit_clean' // clean verdict served from cache
  | 'cache_hit_block' // block verdict served from cache (spam-retry dedupe)
  | 'allow_llm' // LLM said clean (or flagged below threshold)
  | 'block' // LLM said toxic above threshold
  | 'fail_open'; // HTTP / timeout / network error — message allowed through

/**
 * Sub-classification ONLY for fail_open outcomes, so on-call can
 * distinguish "ai-core slow" from "ai-core dead" in a moderation incident.
 * Empty string for all other outcomes keeps Prometheus cardinality bounded.
 */
export type FailOpenReason = '' | 'timeout' | 'http_error' | 'network_error';

@Injectable()
export class PreSendModerationMetricsService {
  private readonly logger = new Logger(PreSendModerationMetricsService.name);
  private readonly outcomeCounter: Counter;
  private readonly durationHistogram: Histogram;

  constructor(private readonly metrics: MetricsService) {
    this.outcomeCounter = this.metrics.getCounter(
      'pre_send_moderation_total',
      'Pre-send moderation gate outcomes by result, conversation type, and fail-open reason',
      ['result', 'conv_type', 'fail_open_reason'],
    );

    this.durationHistogram = this.metrics.getHistogram(
      'pre_send_moderation_duration_ms',
      'Pre-send moderation duration in milliseconds, bucketed by outcome',
      ['outcome'],
      // Buckets tuned for the 2s timeout default — anything past 2000ms
      // should have already produced a fail_open=timeout outcome.
      [10, 25, 50, 100, 250, 500, 1000, 2000, 5000],
    );

    this.logger.log('Pre-send moderation metrics initialized');
  }

  recordOutcome(
    result: PreSendModerationOutcome,
    convType: ConversationType | 'unknown',
    failOpenReason: FailOpenReason = '',
  ): void {
    this.outcomeCounter.labels(result, convType, failOpenReason).inc();
  }

  observeDuration(ms: number, outcome: PreSendModerationOutcome): void {
    this.durationHistogram.labels(outcome).observe(ms);
  }
}
