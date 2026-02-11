import { Controller, Logger, OnModuleInit } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  type NotificationRequestedEvent,
  type NotificationBatchCommand,
} from '@libs/contracts';
import { NotificationService } from '../services/notification.service';
import { NotificationBatcher } from '../services/notification.batcher';
import { NotificationMetrics } from '../services/notification.metrics';

@Controller()
export class NotificationConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly batcher: NotificationBatcher,
    private readonly metrics: NotificationMetrics,
  ) {}

  onModuleInit() {
    // Wire batcher's flush callback to process batched notifications
    this.batcher.onBatchReady = (userId, notifications) => {
      this.logger.debug(
        `Batch ready for user ${userId}: ${notifications.length} notifications`,
      );
      void this.processBatchedNotifications(notifications);
    };
  }

  /**
   * Handle single notification requests.
   * Adds to batcher for dedup/grouping, or processes immediately if batch flushes.
   */
  @EventPattern(KafkaTopics.NotificationRequested)
  async onNotificationRequested(
    @Payload() payload: NotificationRequestedEvent,
  ): Promise<void> {
    const stopTimer = this.metrics.startProcessingTimer();

    try {
      this.logger.debug(
        `Notification requested for user ${payload.user_id} [trace=${payload.trace_id}]`,
      );

      // Add to batch — returns notifications if batch is full
      const flushed = await this.batcher.addToBatch(payload);

      if (flushed && flushed.length > 0) {
        await this.processBatchedNotifications(flushed);
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle notification for user ${payload.user_id}`,
        error instanceof Error ? error.stack : error,
      );
      this.metrics.recordFailed(1);
    } finally {
      stopTimer();
    }
  }

  /**
   * Handle batch notification commands (from other services sending bulk)
   */
  @EventPattern(KafkaTopics.NotificationBatch)
  async onNotificationBatch(
    @Payload() payload: NotificationBatchCommand,
  ): Promise<void> {
    this.logger.log(
      `Batch command received: ${payload.notifications.length} notifications [batch=${payload.batch_id}]`,
    );

    try {
      await this.notificationService.processBatch(payload.notifications);
    } catch (error) {
      this.logger.error(
        `Failed to process notification batch ${payload.batch_id}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Process a group of batched notifications
   * Groups by user and sends a consolidated notification per user
   */
  private async processBatchedNotifications(
    notifications: NotificationRequestedEvent[],
  ): Promise<void> {
    if (notifications.length === 1) {
      await this.notificationService.processNotification(notifications[0]);
      return;
    }

    await this.notificationService.processBatch(notifications);
  }
}
