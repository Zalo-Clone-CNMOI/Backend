import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationOutboxPublisher } from '@libs/kafka';
import {
  type NotificationRequestedEvent,
  NotificationType,
  type MessageMention,
  MENTION_ALL_SENTINEL,
} from '@libs/contracts';
import { User, ConversationMember } from '@libs/database';
import { MessageRepository } from '@libs/scylla';
import { ChatPublisher } from '../services/chat.publisher';
import {
  getConversationMemberIds,
  getUserDisplayName,
} from '../utils/notification.helper';

@Injectable()
export class MessageConsumerSharedService {
  readonly logger = new Logger(MessageConsumerSharedService.name);

  private readonly consistencyCounters: Record<
    'duplicate' | 'replay' | 'timestamp_mismatch',
    number
  > = {
    duplicate: 0,
    replay: 0,
    timestamp_mismatch: 0,
  };

  constructor(
    private readonly notificationPublisher: NotificationOutboxPublisher,
    private readonly publisher: ChatPublisher,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ConversationMember)
    private readonly conversationMemberRepo: Repository<ConversationMember>,
    private readonly messageRepo: MessageRepository,
  ) {}

  bumpConsistencyCounter(
    metric: 'duplicate' | 'replay' | 'timestamp_mismatch',
    fields: Record<string, unknown>,
  ): void {
    this.consistencyCounters[metric] += 1;
    this.logger.warn('[consistency-telemetry]', {
      metric,
      count: this.consistencyCounters[metric],
      ...fields,
    });
  }

  isValidEpochTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  isNonRetryableBindError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return /Unexpected unset value for bind variable/i.test(error.message);
  }

  logPoisonPayload(
    context: string,
    traceId: string,
    fields: Record<string, unknown>,
  ): void {
    this.bumpConsistencyCounter('replay', {
      traceId,
      context: `${context}_poison_payload`,
      ...fields,
    });
    this.logger.error(`[${traceId}] ${context} skipped poison payload`, fields);
  }

  async emitMessageNotification(
    conversationId: string,
    senderId: string,
    messageBody: string,
    messageId: string,
    traceId?: string,
    mentions?: MessageMention[],
  ): Promise<void> {
    const notificationTraceId = traceId || `trace-noti-${Date.now()}`;
    this.logger.debug(
      `[${notificationTraceId}] Emitting message notification`,
      { messageId, conversationId },
    );

    try {
      const recipientIds = await getConversationMemberIds(
        this.conversationMemberRepo,
        conversationId,
      );
      const recipients = recipientIds.filter((id) => id !== senderId);
      if (recipients.length === 0) {
        this.logger.debug(
          `[${notificationTraceId}] No recipients for notification.`,
        );
        return;
      }

      // Build mentioned-user set
      const mentionedUserIds = new Set<string>();
      if (mentions && mentions.length > 0) {
        const isAtAll = mentions.some((m) => m.mention_type === 'all');
        if (isAtAll) {
          recipients.forEach((id) => mentionedUserIds.add(id));
        } else {
          for (const m of mentions) {
            if (m.user_id !== MENTION_ALL_SENTINEL && m.user_id !== senderId) {
              mentionedUserIds.add(m.user_id);
            }
          }
        }
      }

      const senderName = await getUserDisplayName(this.userRepo, senderId);
      const preview =
        messageBody.length > 100
          ? `${messageBody.substring(0, 100)}...`
          : messageBody;

      const batchSize = 50;
      let successCount = 0;
      let failureCount = 0;

      for (let offset = 0; offset < recipients.length; offset += batchSize) {
        const batchRecipients = recipients.slice(offset, offset + batchSize);
        const publishTasks = batchRecipients.map((recipientId) => {
          const isMentioned = mentionedUserIds.has(recipientId);
          const notification: NotificationRequestedEvent = {
            channel: 'push',
            user_id: recipientId,
            title: isMentioned
              ? `${senderName ?? 'Someone'} đã nhắc bạn`
              : senderName || 'New message',
            body: preview,
            type: isMentioned
              ? NotificationType.Mention
              : NotificationType.ChatMessage,
            data: {
              conversation_id: conversationId,
              message_id: messageId,
              sender_id: senderId,
              ...(isMentioned ? { is_mention: 'true' } : {}),
            },
            rich: {
              priority: isMentioned ? 'high' : 'normal',
              thread_id: conversationId,
              category: isMentioned ? 'mention' : 'message',
            },
            requested_at: Date.now(),
            trace_id: notificationTraceId,
          };
          return this.notificationPublisher.publish(notification);
        });

        const batchResults = await Promise.allSettled(publishTasks);
        batchResults.forEach((result, index) => {
          if (result.status === 'rejected' || result.value === 'failed') {
            failureCount += 1;
            this.logger.error(
              `[${notificationTraceId}] Failed to enqueue notification for ${batchRecipients[index]}`,
              result.status === 'rejected' ? result.reason : 'publish_failed',
            );
            return;
          }
          successCount += 1;
        });
      }

      // Increment counter for mentioned users (badge UI).
      // Known v1 trade-off: this counter is non-idempotent. When a Kafka replay
      // re-runs the post-persist path (status='pending' branch in
      // SendMessageHandler), the same user's badge can be incremented twice.
      // Replays are rare (require mid-process failure) and the counter is
      // reset when the user opens the conversation, so off-by-one is accepted.
      const recipientSet = new Set(recipients);
      const counterTargets = Array.from(mentionedUserIds).filter((id) =>
        recipientSet.has(id),
      );
      if (counterTargets.length > 0) {
        await this.messageRepo.incrementUnreadMentionCount(
          counterTargets,
          conversationId,
        );
      }

      this.logger.log(
        `[${notificationTraceId}] Notification enqueue: ${recipients.length} recipients (success=${successCount}, failed=${failureCount}, mentioned=${mentionedUserIds.size})`,
        { messageId, successCount, failureCount },
      );
    } catch (error) {
      this.logger.error(
        `[${notificationTraceId}] Failed to emit message notification`,
        {
          messageId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      );
    }
  }
}
