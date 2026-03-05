import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MetricsService } from '@libs/metrics';
import type { Counter, Gauge, Histogram } from 'prom-client';

/**
 * Notification-specific Prometheus metrics
 */
@Injectable()
export class NotificationMetrics implements OnModuleInit {
  private readonly logger = new Logger(NotificationMetrics.name);

  // Counters
  private sentCounter!: Counter;
  private failedCounter!: Counter;
  private suppressedCounter!: Counter;
  private batchedCounter!: Counter;
  private batchFlushedCounter!: Counter;
  private enqueuedCounter!: Counter;
  private retryCounter!: Counter;
  private dlqCounter!: Counter;
  private noTokensCounter!: Counter;
  private invalidTokensCounter!: Counter;

  // Gauges
  private queueDepthGauge!: Gauge;
  private dlqDepthGauge!: Gauge;

  // Histograms
  private processingDuration!: Histogram;

  constructor(private readonly metricsService: MetricsService) {}

  onModuleInit() {
    this.initializeMetrics();
    this.logger.log('Notification metrics initialized');
  }

  private initializeMetrics(): void {
    // Counters
    this.sentCounter = this.metricsService.getCounter(
      'notification_sent_total',
      'Total push notifications successfully sent',
    );

    this.failedCounter = this.metricsService.getCounter(
      'notification_failed_total',
      'Total push notifications that failed to send',
    );

    this.suppressedCounter = this.metricsService.getCounter(
      'notification_suppressed_total',
      'Total notifications suppressed by user preferences',
    );

    this.batchedCounter = this.metricsService.getCounter(
      'notification_batched_total',
      'Total notifications added to batch queue',
    );

    this.batchFlushedCounter = this.metricsService.getCounter(
      'notification_batch_flushed_total',
      'Total notifications flushed from batch',
    );

    this.enqueuedCounter = this.metricsService.getCounter(
      'notification_enqueued_total',
      'Total notifications enqueued for delivery',
    );

    this.retryCounter = this.metricsService.getCounter(
      'notification_retry_total',
      'Total notification delivery retries',
    );

    this.dlqCounter = this.metricsService.getCounter(
      'notification_dlq_total',
      'Total notifications moved to dead letter queue',
    );

    this.noTokensCounter = this.metricsService.getCounter(
      'notification_no_tokens_total',
      'Total notifications skipped due to no active device tokens',
    );

    this.invalidTokensCounter = this.metricsService.getCounter(
      'notification_invalid_tokens_total',
      'Total invalid FCM tokens detected and deactivated',
    );

    // Gauges
    this.queueDepthGauge = this.metricsService.getGauge(
      'notification_queue_depth',
      'Current notification queue depth',
    );

    this.dlqDepthGauge = this.metricsService.getGauge(
      'notification_dlq_depth',
      'Current dead letter queue depth',
    );

    // Histograms
    this.processingDuration = this.metricsService.getHistogram(
      'notification_processing_duration_seconds',
      'Time to process a single notification',
      [],
      [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    );
  }

  // ── Recording methods ──────────────────────────────────────────────

  recordSent(count = 1): void {
    this.sentCounter.inc(count);
  }

  recordFailed(count = 1): void {
    this.failedCounter.inc(count);
  }

  recordSuppressed(): void {
    this.suppressedCounter.inc();
  }

  recordBatched(): void {
    this.batchedCounter.inc();
  }

  recordBatchFlushed(count: number): void {
    this.batchFlushedCounter.inc(count);
  }

  recordEnqueued(): void {
    this.enqueuedCounter.inc();
  }

  recordRetry(): void {
    this.retryCounter.inc();
  }

  recordDlq(): void {
    this.dlqCounter.inc();
  }

  recordNoTokens(): void {
    this.noTokensCounter.inc();
  }

  recordInvalidTokens(count: number): void {
    this.invalidTokensCounter.inc(count);
  }

  setQueueDepth(depth: number): void {
    this.queueDepthGauge.set(depth);
  }

  setDlqDepth(depth: number): void {
    this.dlqDepthGauge.set(depth);
  }

  startProcessingTimer(): () => number {
    return this.processingDuration.startTimer();
  }
}
