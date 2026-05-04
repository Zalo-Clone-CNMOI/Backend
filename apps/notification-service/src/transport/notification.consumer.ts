import { Controller, Logger, OnModuleInit } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  NotificationType,
  type CallEndedEvent,
  type CallStartedEvent,
  type NotificationRequestedEvent,
  type NotificationBatchCommand,
} from '@libs/contracts';
import { NotificationService } from '../services/notification.service';
import { NotificationBatcher } from '../services/notification.batcher';
import { NotificationMetrics } from '../services/notification.metrics';

const MISSED_CALL_REASONS: ReadonlySet<string> = new Set([
  'timeout',
  'rejected',
  'missed',
]);

@Controller()
export class NotificationConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly batcher: NotificationBatcher,
    private readonly metrics: NotificationMetrics,
  ) {}

  onModuleInit() {
    this.batcher.onBatchReady = (userId, notifications) => {
      this.logger.debug(
        `Batch ready for user ${userId}: ${notifications.length} notifications`,
      );
      void this.processBatchedNotifications(notifications).catch((error) => {
        this.logger.error(
          `Failed to process batched notifications for user ${userId}`,
          error instanceof Error ? error.stack : error,
        );
        this.metrics.recordFailed(notifications.length);
      });
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
   * Incoming-call push for every offline / non-initiator participant.
   * Bypasses the batcher: a 3s delay or dedup would break call UX.
   */
  @EventPattern(KafkaTopics.CallStarted)
  async onCallStarted(@Payload() payload: CallStartedEvent): Promise<void> {
    const recipients = payload.push_recipient_ids ?? [];
    if (recipients.length === 0) return;

    const callTypeLabel = payload.call_type === 'audio' ? 'thoại' : 'video';
    const title = `Cuộc gọi ${callTypeLabel} đến`;

    await Promise.all(
      recipients.map((userId) =>
        this.notificationService
          .processNotification({
            channel: 'push',
            user_id: userId,
            type: NotificationType.IncomingCall,
            title,
            body: 'Bạn có một cuộc gọi đến',
            data: {
              call_id: payload.call_id,
              conversation_id: payload.conversation_id,
              conversation_type: payload.conversation_type,
              call_type: payload.call_type,
              initiator_id: payload.initiator_id,
              action: 'incoming_call',
            },
            rich: {
              priority: 'high',
              category: 'call',
              collapse_key: `call:${payload.call_id}`,
              bypass_quiet_hours: true,
            },
            requested_at: Date.now(),
            trace_id: payload.trace_id,
          })
          .catch((err: unknown) =>
            this.logger.error(
              `IncomingCall push failed user=${userId} call=${payload.call_id}`,
              err instanceof Error ? err.stack : String(err),
            ),
          ),
      ),
    );
  }

  /**
   * Missed-call notification for direct calls only — group calls would be
   * noisy. Routes a normal-priority push to every non-initiator participant
   * when the call ended without being answered.
   */
  @EventPattern(KafkaTopics.CallEnded)
  async onCallEnded(@Payload() payload: CallEndedEvent): Promise<void> {
    if (payload.conversation_type !== 'direct') return;
    if (!payload.reason || !MISSED_CALL_REASONS.has(payload.reason)) return;

    const callees = (payload.participant_ids ?? []).filter(
      (id) => id !== payload.initiator_id,
    );
    if (callees.length === 0) return;

    await Promise.all(
      callees.map((userId) =>
        this.notificationService
          .processNotification({
            channel: 'push',
            user_id: userId,
            type: NotificationType.MissedCall,
            title: 'Cuộc gọi nhỡ',
            body: 'Bạn có một cuộc gọi nhỡ',
            data: {
              call_id: payload.call_id,
              conversation_id: payload.conversation_id,
              initiator_id: payload.initiator_id,
              action: 'missed_call',
            },
            rich: {
              priority: 'normal',
              category: 'call',
            },
            requested_at: Date.now(),
            trace_id: payload.trace_id,
          })
          .catch((err: unknown) =>
            this.logger.error(
              `MissedCall push failed user=${userId} call=${payload.call_id}`,
              err instanceof Error ? err.stack : String(err),
            ),
          ),
      ),
    );
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
