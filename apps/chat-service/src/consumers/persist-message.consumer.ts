import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  KafkaTopics,
  type ChatMessageSendCommand,
  type ChatMessageCreatedEvent,
  type ChatMessageEditCommand,
  type ChatMessageUpdatedEvent,
  type ChatMessageDeleteCommand,
  type ChatMessageDeletedEvent,
  type ChatReactionAddCommand,
  type ChatReactionAddedEvent,
  type ChatReactionRemoveCommand,
  type ChatReactionRemovedEvent,
  type NotificationRequestedEvent,
  NotificationType,
  AiModerationRequestEvent,
} from '@libs/contracts';
import { MessageRepository } from '@libs/scylla';
import { CacheService } from '@libs/redis';
import { ConversationMembershipService } from '@libs/mvp-access';
import { User, ConversationMember } from '@libs/database';
import { ChatPublisher } from '../services/chat.publisher';
import {
  getConversationMemberIds,
  getUserDisplayName,
} from '../utils/notification.helper';

@Controller()
export class PersistMessageConsumer {
  private readonly logger = new Logger(PersistMessageConsumer.name);

  constructor(
    private readonly repo: MessageRepository,
    private readonly publisher: ChatPublisher,
    private readonly cacheService: CacheService,
    private readonly membershipService: ConversationMembershipService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ConversationMember)
    private readonly conversationMemberRepo: Repository<ConversationMember>,
  ) {}

  @EventPattern(KafkaTopics.ChatMessageSend)
  async onSend(@Payload() payload: ChatMessageSendCommand) {
    const startTime = Date.now();
    const createdAt = startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;

    this.logger.debug(`[${traceId}] ChatMessageSend started`, {
      messageId: payload.message_id,
      conversationId: payload.conversation_id,
      senderId: payload.sender_id,
    });

    try {
      const canAccess = await this.membershipService.canUserAccessConversation(
        payload.sender_id,
        payload.conversation_id,
      );
      if (!canAccess) {
        this.logger.warn(`[${traceId}] Unauthorized message attempt`, {
          senderId: payload.sender_id,
          conversationId: payload.conversation_id,
        });
        return;
      }

      const seen = await this.repo.wasMessageSeen(payload.message_id);
      if (seen) {
        this.logger.debug(
          `[${traceId}] Message already processed (idempotent)`,
          {
            messageId: payload.message_id,
          },
        );
        return;
      }

      await this.repo.insertMessage({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        created_at: createdAt,
        attachments: payload.attachments,
        reply_to_message_id: payload.reply_to_message_id,
      });

      await this.repo.markMessageSeen(
        payload.message_id,
        payload.conversation_id,
        createdAt,
      );

      const event: ChatMessageCreatedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        created_at: createdAt,
        attachments: payload.attachments,
        reply_to_message_id: payload.reply_to_message_id,
        trace_id: traceId,
      };

      await this.publisher.emit(KafkaTopics.ChatMessageCreated, event);
      this.logger.log(`[${traceId}] ChatMessageCreated event emitted`, {
        messageId: payload.message_id,
      });

      // ── AI Moderation: auto-moderate every new message ──────────────
      void (async () => {
        try {
          const moderationEvent: AiModerationRequestEvent = {
            message_id: payload.message_id,
            conversation_id: payload.conversation_id,
            sender_id: payload.sender_id,
            body: payload.body,
            requested_at: Date.now(),
            trace_id: traceId,
          };
          await this.publisher.emit(
            KafkaTopics.AiModerationRequest,
            moderationEvent,
          );
          this.logger.debug(
            `[${traceId}] AiModerationRequest emitted for message: ${payload.message_id}`,
          );
        } catch (err) {
          this.logger.error(
            `[${traceId}] AiModerationRequest emit failed`,
            err,
          );
        }
      })();

      // ── Cache invalidation ───────────────────────────────────────────
      void (async () => {
        try {
          await this.cacheService.invalidateRecentMessages(
            payload.conversation_id,
          );
        } catch (err) {
          this.logger.error(`[${traceId}] Cache invalidation failed`, err);
        }
      })();
      this.logger.debug(`[${traceId}] Cache invalidated`, {
        conversationId: payload.conversation_id,
      });

      this.logger.log(`[${traceId}] ChatMessageSend completed`, {
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error(`[${traceId}] ChatMessageSend failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  @EventPattern(KafkaTopics.ChatMessageEdit)
  async onEdit(@Payload() payload: ChatMessageEditCommand) {
    const startTime = Date.now();
    const editedAt = payload.edited_at ?? startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;

    this.logger.debug(`[${traceId}] ChatMessageEdit started`, {
      messageId: payload.message_id,
      conversationId: payload.conversation_id,
    });

    try {
      await this.repo.updateMessageBody(
        payload.conversation_id,
        editedAt,
        payload.message_id,
        payload.new_body,
        editedAt,
      );

      const event: ChatMessageUpdatedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.new_body,
        edited_at: editedAt,
        trace_id: traceId,
      };

      await this.publisher.emit(KafkaTopics.ChatMessageUpdated, event);
      this.logger.log(`[${traceId}] ChatMessageUpdated event emitted`, {
        messageId: payload.message_id,
        duration: Date.now() - startTime,
      });

      await (async () => {
        try {
          await this.cacheService.invalidateRecentMessages(
            payload.conversation_id,
          );
        } catch (err) {
          this.logger.error(`[${traceId}] Cache invalidation failed`, err);
        }
      })();
    } catch (error) {
      this.logger.error(`[${traceId}] ChatMessageEdit failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @EventPattern(KafkaTopics.ChatMessageDelete)
  async onDelete(@Payload() payload: ChatMessageDeleteCommand) {
    const startTime = Date.now();
    const deletedAt = payload.deleted_at ?? startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;

    this.logger.debug(`[${traceId}] ChatMessageDelete started`, {
      messageId: payload.message_id,
      conversationId: payload.conversation_id,
    });

    try {
      await this.repo.softDeleteMessage(
        payload.conversation_id,
        deletedAt,
        payload.message_id,
        deletedAt,
      );

      const event: ChatMessageDeletedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        deleted_at: deletedAt,
        trace_id: traceId,
      };

      await this.publisher.emit(KafkaTopics.ChatMessageDeleted, event);
      this.logger.log(`[${traceId}] ChatMessageDeleted event emitted`, {
        messageId: payload.message_id,
        duration: Date.now() - startTime,
      });

      await (async () => {
        try {
          await this.cacheService.invalidateRecentMessages(
            payload.conversation_id,
          );
        } catch (err) {
          this.logger.error(`[${traceId}] Cache invalidation failed`, err);
        }
      })();
    } catch (error) {
      this.logger.error(`[${traceId}] ChatMessageDelete failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @EventPattern(KafkaTopics.ChatReactionAdd)
  async onReactionAdd(@Payload() payload: ChatReactionAddCommand) {
    const startTime = Date.now();
    const createdAt = payload.created_at ?? startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;

    this.logger.debug(`[${traceId}] ChatReactionAdd started`, {
      messageId: payload.message_id,
      userId: payload.user_id,
      reaction: payload.reaction_type,
    });

    try {
      // Note: Race condition still exists here. Needs atomic upsert.
      await this.repo.addReaction({
        message_id: payload.message_id,
        user_id: payload.user_id,
        reaction_type: payload.reaction_type,
        created_at: createdAt,
      });

      const event: ChatReactionAddedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        user_id: payload.user_id,
        reaction_type: payload.reaction_type,
        created_at: createdAt,
        trace_id: traceId,
      };

      await this.publisher.emit(KafkaTopics.ChatReactionAdded, event);
      this.logger.log(`[${traceId}] ChatReactionAdded event emitted`, {
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error(`[${traceId}] ChatReactionAdd failed`, {
        messageId: payload.message_id,
        userId: payload.user_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @EventPattern(KafkaTopics.ChatReactionRemove)
  async onReactionRemove(@Payload() payload: ChatReactionRemoveCommand) {
    const startTime = Date.now();
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;

    this.logger.debug(`[${traceId}] ChatReactionRemove started`, {
      messageId: payload.message_id,
      userId: payload.user_id,
    });

    try {
      await this.repo.removeReaction(payload.message_id, payload.user_id);

      const event: ChatReactionRemovedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        user_id: payload.user_id,
        trace_id: traceId,
      };

      await this.publisher.emit(KafkaTopics.ChatReactionRemoved, event);
      this.logger.log(`[${traceId}] ChatReactionRemoved event emitted`, {
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error(`[${traceId}] ChatReactionRemove failed`, {
        messageId: payload.message_id,
        userId: payload.user_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async emitMessageNotification(
    conversationId: string,
    senderId: string,
    messageBody: string,
    messageId: string,
    traceId?: string,
  ): Promise<void> {
    const notificationTraceId = traceId || `trace-noti-${Date.now()}`;
    this.logger.debug(
      `[${notificationTraceId}] Emitting message notification`,
      {
        messageId,
        conversationId,
      },
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

      const senderName = await getUserDisplayName(this.userRepo, senderId);
      const preview =
        messageBody.length > 100
          ? `${messageBody.substring(0, 100)}...`
          : messageBody;

      for (const recipientId of recipients) {
        const notification: NotificationRequestedEvent = {
          channel: 'push',
          user_id: recipientId,
          title: senderName || 'New message',
          body: preview,
          type: NotificationType.ChatMessage,
          data: {
            conversation_id: conversationId,
            message_id: messageId,
            sender_id: senderId,
          },
          rich: {
            priority: 'high',
            thread_id: conversationId,
            category: 'message',
          },
          requested_at: Date.now(),
          trace_id: notificationTraceId,
        };
        await this.publisher
          .emit(KafkaTopics.NotificationRequested, notification)
          .catch((err) =>
            this.logger.error(
              `[${notificationTraceId}] Failed to emit notification for ${recipientId}`,
              err,
            ),
          );
      }

      this.logger.log(
        `[${notificationTraceId}] Notifications emitted for ${recipients.length} recipients`,
        { messageId },
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
