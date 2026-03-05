import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '@libs/redis';
import type { RedisClientType } from 'redis';
import type { NotificationRequestedEvent } from '@libs/contracts';
import { NotificationMetrics } from './notification.metrics';

/**
 * Batches notifications per user to avoid notification spam.
 * Collects notifications in Redis and flushes them after a configurable delay
 * or when the batch reaches a size limit.
 */
@Injectable()
export class NotificationBatcher implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationBatcher.name);

  private readonly BATCH_KEY_PREFIX = 'notif:batch:';
  private readonly BATCH_DELAY_MS = 3000; // 3 seconds
  private readonly MAX_BATCH_SIZE = 20;
  private readonly BATCH_TTL_SECONDS = 60; // Redis TTL safety

  private flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: RedisClientType,
    private readonly metrics: NotificationMetrics,
  ) {}

  onModuleDestroy() {
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
    this.logger.log('Notification batcher shut down, timers cleared');
  }

  /**
   * Add a notification to the user's batch.
   * Returns the current batch if it should be flushed immediately (size limit),
   * or null if the batch is still collecting.
   */
  async addToBatch(
    notification: NotificationRequestedEvent,
  ): Promise<NotificationRequestedEvent[] | null> {
    const userId = notification.user_id;
    const key = this.getBatchKey(userId);

    try {
      // Push to Redis list
      const length = await this.redis.rPush(key, JSON.stringify(notification));
      await this.redis.expire(key, this.BATCH_TTL_SECONDS);
      this.metrics.recordBatched();

      // If batch is full, flush immediately
      if (length >= this.MAX_BATCH_SIZE) {
        this.clearTimer(userId);
        return this.flushBatch(userId);
      }

      // Set/reset the delay timer
      this.resetTimer(userId);
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to add notification to batch for ${userId}`,
        error,
      );
      // Fallback: return single notification for immediate processing
      return [notification];
    }
  }

  private static readonly FLUSH_SCRIPT = `
    local items = redis.call('LRANGE', KEYS[1], 0, -1)
    redis.call('DEL', KEYS[1])
    return items
  `;

  async flushBatch(userId: string): Promise<NotificationRequestedEvent[]> {
    const key = this.getBatchKey(userId);
    this.clearTimer(userId);

    try {
      const items = (await this.redis.eval(NotificationBatcher.FLUSH_SCRIPT, {
        keys: [key],
        arguments: [],
      })) as string[];

      if (items.length === 0) return [];

      const notifications = items.map(
        (item) => JSON.parse(item) as NotificationRequestedEvent,
      );

      this.logger.debug(
        `Flushed batch of ${notifications.length} for user ${userId}`,
      );
      this.metrics.recordBatchFlushed(notifications.length);
      return notifications;
    } catch (error) {
      this.logger.error(`Failed to flush batch for ${userId}`, error);
      return [];
    }
  }

  /**
   * Set a delayed flush timer for a user
   */
  private resetTimer(userId: string): void {
    this.clearTimer(userId);

    const timer = setTimeout(() => {
      this.flushTimers.delete(userId);
      void this.flushBatch(userId).then((notifications) => {
        if (notifications.length > 0) {
          // Emit a flush event (handled by the consumer or service layer)
          this.onBatchReady?.(userId, notifications);
        }
      });
    }, this.BATCH_DELAY_MS);

    this.flushTimers.set(userId, timer);
  }

  private clearTimer(userId: string): void {
    const existing = this.flushTimers.get(userId);
    if (existing) {
      clearTimeout(existing);
      this.flushTimers.delete(userId);
    }
  }

  private getBatchKey(userId: string): string {
    return `${this.BATCH_KEY_PREFIX}${userId}`;
  }

  /**
   * Callback that can be set by the consumer to handle flushed batches
   */
  onBatchReady:
    | ((userId: string, notifications: NotificationRequestedEvent[]) => void)
    | null = null;
}
