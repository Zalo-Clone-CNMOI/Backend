import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '@libs/redis';
import type { RedisClientType } from 'redis';
import type { NotificationRequestedEvent } from '@libs/contracts';
import { NotificationMetrics } from './notification.metrics';

/**
 * Delivery queue with Dead Letter Queue (DLQ) and retry logic.
 *
 * Flow: main queue → process → on failure → retry (up to MAX_RETRIES) → DLQ
 */
/**
 * Notification delivery queue with DLQ and retry logic.
 * This system is unused, maybe be utilized in the future for more robust delivery.
 */

@Injectable()
export class NotificationQueue implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationQueue.name);

  private readonly QUEUE_KEY = 'notif:queue:pending';
  private readonly DLQ_KEY = 'notif:queue:dlq';
  private readonly RETRY_KEY_PREFIX = 'notif:retry:';
  private readonly MAX_RETRIES = 3;
  private readonly QUEUE_TTL = 86400; // 24 hours

  private isProcessing = false;

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: RedisClientType,
    private readonly metrics: NotificationMetrics,
  ) {}

  onModuleDestroy() {
    this.isProcessing = false;
  }

  /**
   * Enqueue a notification for delivery
   */
  async enqueue(notification: NotificationRequestedEvent): Promise<void> {
    try {
      const item = JSON.stringify({
        notification,
        enqueued_at: Date.now(),
        retry_count: 0,
      });
      await this.redis.rPush(this.QUEUE_KEY, item);
      await this.redis.expire(this.QUEUE_KEY, this.QUEUE_TTL);

      this.metrics.recordEnqueued();
    } catch (error) {
      this.logger.error('Failed to enqueue notification', error);
      throw error;
    }
  }

  /**
   * Dequeue the next notification for processing
   */
  async dequeue(): Promise<{
    notification: NotificationRequestedEvent;
    retryCount: number;
  } | null> {
    try {
      const item = await this.redis.lPop(this.QUEUE_KEY);
      if (!item) return null;

      const parsed = JSON.parse(item) as {
        notification: NotificationRequestedEvent;
        retry_count: number;
        enqueued_at: number;
      };

      const age = Date.now() - parsed.enqueued_at;
      if (age > this.QUEUE_TTL * 1000) {
        this.logger.warn(
          `Discarding stale notification for user ${parsed.notification.user_id} (age: ${Math.floor(age / 1000)}s)`,
        );
        return null;
      }

      return {
        notification: parsed.notification,
        retryCount: parsed.retry_count,
      };
    } catch (error) {
      this.logger.error('Failed to dequeue notification', error);
      return null;
    }
  }

  /**
   * Handle a failed notification: retry or move to DLQ
   */
  async handleFailure(
    notification: NotificationRequestedEvent,
    retryCount: number,
    errorMessage: string,
  ): Promise<void> {
    const nextRetry = retryCount + 1;

    if (nextRetry >= this.MAX_RETRIES) {
      // Move to DLQ
      await this.moveToDlq(notification, errorMessage, nextRetry);
      this.metrics.recordDlq();
      return;
    }

    // Re-enqueue with incremented retry count
    try {
      const item = JSON.stringify({
        notification,
        enqueued_at: Date.now(),
        retry_count: nextRetry,
      });
      const retryKey = `${this.RETRY_KEY_PREFIX}${notification.user_id}`;
      await this.redis.rPush(retryKey, item);
      await this.redis.expire(retryKey, this.QUEUE_TTL);
      this.metrics.recordRetry();
      this.logger.warn(
        `Notification retry ${nextRetry}/${this.MAX_RETRIES} for user ${notification.user_id}`,
      );
    } catch (error) {
      this.logger.error('Failed to re-enqueue notification for retry', error);
      await this.moveToDlq(notification, errorMessage, nextRetry);
    }
  }

  /**
   * Move a notification to the Dead Letter Queue
   */
  private async moveToDlq(
    notification: NotificationRequestedEvent,
    errorMessage: string,
    retryCount: number,
  ): Promise<void> {
    try {
      const dlqItem = JSON.stringify({
        notification,
        error_message: errorMessage,
        retry_count: retryCount,
        moved_at: Date.now(),
      });
      await this.redis.rPush(this.DLQ_KEY, dlqItem);
      this.logger.error(
        `Notification moved to DLQ for user ${notification.user_id} after ${retryCount} retries: ${errorMessage}`,
      );
    } catch (error) {
      this.logger.error('Failed to move notification to DLQ', error);
    }
  }

  /**
   * Get current queue depth (for monitoring)
   */
  async getQueueDepth(): Promise<number> {
    try {
      return await this.redis.lLen(this.QUEUE_KEY);
    } catch {
      return 0;
    }
  }

  /**
   * Get DLQ depth (for monitoring)
   */
  async getDlqDepth(): Promise<number> {
    try {
      return await this.redis.lLen(this.DLQ_KEY);
    } catch {
      return 0;
    }
  }
}
