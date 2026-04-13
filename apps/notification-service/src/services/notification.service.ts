import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreference, NotificationLog } from '@libs/database';
import {
  type NotificationRequestedEvent,
  type NotificationSentEvent,
  type NotificationFailedEvent,
  type RichNotificationPayload,
  KafkaTopics,
} from '@libs/contracts';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationProvider as NotificationProviderEnum,
} from '@app/constant';
import {
  NOTIFICATION_PROVIDER,
  type INotificationProvider,
  type SendNotificationInput,
} from '../providers/notification.provider';
import { NotificationPublisher } from '../transport/notification.publisher';
import { NotificationMetrics } from './notification.metrics';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(NOTIFICATION_PROVIDER)
    private readonly provider: INotificationProvider,
    private readonly publisher: NotificationPublisher,
    private readonly metrics: NotificationMetrics,
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepo: Repository<NotificationPreference>,
    @InjectRepository(NotificationLog)
    private readonly logRepo: Repository<NotificationLog>,
  ) {}

  /**
   * Process a single notification request.
   * Checks preferences, builds payload, sends via provider, logs result.
   */
  async processNotification(
    payload: NotificationRequestedEvent,
  ): Promise<void> {
    const { user_id, title, body, data, rich, type, trace_id } = payload;

    // 1. Check user preferences
    const allowed = await this.checkPreferences(user_id);
    if (!allowed) {
      this.logger.debug(
        `Notification suppressed for user ${user_id} (preferences)`,
      );
      this.metrics.recordSuppressed();
      return;
    }

    // 2. Build send input with rich notification support
    const input = this.buildSendInput(user_id, title, body, data, rich);

    // 3. Send via provider
    const result = await this.provider.send(input);

    // 4. Log result
    await this.logNotification(
      user_id,
      title,
      body,
      data ?? null,
      result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
    );

    // 5. Emit Kafka event
    if (result.ok) {
      const sentEvent: NotificationSentEvent = {
        provider: 'fcm',
        channel: 'push',
        user_id,
        type,
        success_count: result.successCount,
        sent_at: Date.now(),
        trace_id,
      };
      await this.publisher.emit(KafkaTopics.NotificationSent, sentEvent);
    } else {
      const failedEvent: NotificationFailedEvent = {
        provider: 'fcm',
        channel: 'push',
        user_id,
        type,
        error_code: 'SEND_FAILED',
        error_message: `All ${result.failureCount} tokens failed`,
        retry_count: 0,
        failed_at: Date.now(),
        trace_id,
      };
      await this.publisher.emit(KafkaTopics.NotificationFailed, failedEvent);
    }
  }

  /**
   * Process a batch of notifications
   */
  async processBatch(
    notifications: NotificationRequestedEvent[],
  ): Promise<void> {
    for (const notification of notifications) {
      try {
        await this.processNotification(notification);
      } catch (error) {
        this.logger.error(
          `Batch notification failed for user ${notification.user_id}`,
          error instanceof Error ? error.stack : error,
        );
        this.metrics.recordFailed(1);
      }
    }
  }

  /**
   * Check if user allows push notifications and is not in quiet hours
   */
  private async checkPreferences(userId: string): Promise<boolean> {
    try {
      const prefs = await this.preferenceRepo.findOne({
        where: { userId },
      });
      if (!prefs) return true;
      if (!prefs.pushEnabled) return false;

      if (prefs.quietHoursStart && prefs.quietHoursEnd) {
        if (this.isInQuietHours(prefs.quietHoursStart, prefs.quietHoursEnd)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to check preferences for ${userId}, allowing`,
        error,
      );
      return true;
    }
  }

  private isInQuietHours(start: string, end: string): boolean {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  /**
   * Build a SendNotificationInput with rich notification data
   */
  private buildSendInput(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    rich?: RichNotificationPayload,
  ): SendNotificationInput {
    const input: SendNotificationInput = { userId, title, body, data };

    if (rich) {
      input.imageUrl = rich.image_url;
      input.priority = rich.priority;
      // Pass extra rich fields through data
      if (rich.action_url) {
        input.data = { ...input.data, action_url: rich.action_url };
      }
      if (rich.thread_id) {
        input.data = { ...input.data, thread_id: rich.thread_id };
      }
      if (rich.category) {
        input.data = { ...input.data, category: rich.category };
      }
    }

    return input;
  }

  /**
   * Persist notification log to the database
   */
  private async logNotification(
    userId: string,
    title: string | null,
    body: string | null,
    data: Record<string, string> | null,
    status: NotificationStatus,
    errorMessage?: string,
  ): Promise<void> {
    try {
      const log = this.logRepo.create({
        userId,
        channel: NotificationChannel.PUSH,
        provider: NotificationProviderEnum.FCM,
        title,
        body,
        data,
        status,
        errorMessage: errorMessage ?? null,
      });
      await this.logRepo.save(log);
    } catch (error) {
      // Log persistence failure should not block notification flow
      this.logger.error(
        `Failed to persist notification log for ${userId}`,
        error,
      );
    }
  }
}
