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
  type AiModerationResultEvent,
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
import {
  ensureConversationAccess,
  ensureMessageOwnership,
} from '../utils/access.helper';

const MODERATION_DELETE_EVENT_TTL_SECONDS = 86400;

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
    const createdAt =
      Number.isFinite(payload.sent_at) && payload.sent_at > 0
        ? payload.sent_at
        : startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;

    this.logger.debug(`[${traceId}] ChatMessageSend started`, {
      messageId: payload.message_id,
      conversationId: payload.conversation_id,
      senderId: payload.sender_id,
    });

    try {
      const hasAccess = await ensureConversationAccess({
        membershipService: this.membershipService,
        logger: this.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        action: 'message',
        messageId: payload.message_id,
      });
      if (!hasAccess) {
        return;
      }

      const acquired = await this.repo.tryBeginMessageProcessing(
        payload.message_id,
        payload.conversation_id,
        createdAt,
      );
      if (!acquired) {
        this.logger.debug(
          `[${traceId}] Message already processed (idempotent)`,
          {
            messageId: payload.message_id,
          },
        );
        return;
      }

      let stored = false;

      try {
        await this.repo.insertMessage({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          sender_id: payload.sender_id,
          body: payload.body,
          created_at: createdAt,
          attachments: payload.attachments,
          reply_to_message_id: payload.reply_to_message_id,
        });

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

        await this.repo.markMessageStored(payload.message_id);
        stored = true;
      } catch (error) {
        if (!stored) {
          await this.repo
            .clearMessageProcessing(payload.message_id)
            .catch(() => {
              this.logger.error(
                `[${traceId}] Failed to clear idempotency lock for message: ${payload.message_id}`,
              );
            });
        }
        throw error;
      }

      await this.emitMessageNotification(
        payload.conversation_id,
        payload.sender_id,
        payload.body,
        payload.message_id,
        traceId,
      );

      // ── AI Moderation: auto-moderate every new message ──────────────
      void (async () => {
        try {
          const moderationEvent: AiModerationRequestEvent = {
            message_id: payload.message_id,
            conversation_id: payload.conversation_id,
            sender_id: payload.sender_id,
            created_at: createdAt,
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

  @EventPattern(KafkaTopics.AiModerationResult)
  async onModerationResult(@Payload() payload: AiModerationResultEvent) {
    if (!payload.is_flagged) {
      return;
    }

    const traceId = payload.trace_id || `mod:${payload.message_id}`;
    const deletedAt = Date.now();
    const deleteEmitKey = this.getModerationDeleteEmitKey(
      payload.conversation_id,
      payload.message_id,
    );
    let effectiveDeletedAt = deletedAt;

    try {
      const applied = await this.repo.trySoftDeleteMessage(
        payload.conversation_id,
        payload.created_at,
        payload.message_id,
        deletedAt,
      );

      if (!applied) {
        const message = await this.repo.getMessage(
          payload.conversation_id,
          payload.created_at,
          payload.message_id,
        );

        if (!message) {
          this.logger.error(
            `[${traceId}] Moderation enforcement failed: message not found`,
            {
              messageId: payload.message_id,
              conversationId: payload.conversation_id,
              createdAt: payload.created_at,
            },
          );
          throw new Error('Moderation target message not found');
        }

        if (message.deleted_at) {
          effectiveDeletedAt = message.deleted_at;

          const alreadyEmitted =
            await this.cacheService.get<boolean>(deleteEmitKey);
          if (alreadyEmitted) {
            this.logger.debug(
              `[${traceId}] Moderation result deduplicated: delete event already emitted`,
              {
                messageId: payload.message_id,
                conversationId: payload.conversation_id,
                deletedAt: message.deleted_at,
              },
            );
            return;
          }

          this.logger.warn(
            `[${traceId}] Retrying delete event emit for previously deleted message`,
            {
              messageId: payload.message_id,
              conversationId: payload.conversation_id,
              deletedAt: message.deleted_at,
            },
          );
        } else {
          this.logger.error(
            `[${traceId}] Moderation enforcement failed: conditional delete not applied`,
            {
              messageId: payload.message_id,
              conversationId: payload.conversation_id,
            },
          );
          throw new Error('Moderation conditional delete was not applied');
        }
      }

      const event: ChatMessageDeletedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        deleted_at: effectiveDeletedAt,
        trace_id: traceId,
      };

      await this.publisher.emit(KafkaTopics.ChatMessageDeleted, event);
      await this.cacheService.set(
        deleteEmitKey,
        true,
        MODERATION_DELETE_EVENT_TTL_SECONDS,
      );

      await this.cacheService
        .invalidateRecentMessages(payload.conversation_id)
        .catch((err) => {
          this.logger.error(
            `[${traceId}] Moderation cache invalidation failed`,
            err,
          );
        });

      this.logger.warn(`[${traceId}] Message soft-deleted by moderation`, {
        messageId: payload.message_id,
        conversationId: payload.conversation_id,
        labels: payload.labels,
      });
    } catch (error) {
      this.logger.error(`[${traceId}] Moderation enforcement failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private getModerationDeleteEmitKey(
    conversationId: string,
    messageId: string,
  ): string {
    return `moderation:delete-event-emitted:${conversationId}:${messageId}`;
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
      const hasAccess = await ensureConversationAccess({
        membershipService: this.membershipService,
        logger: this.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        action: 'edit',
        messageId: payload.message_id,
      });
      if (!hasAccess) {
        return;
      }

      const isOwner = await ensureMessageOwnership({
        repo: this.repo,
        logger: this.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        createdAt: payload.created_at,
        messageId: payload.message_id,
        action: 'edit',
      });
      if (!isOwner) {
        return;
      }

      await this.repo.updateMessageBody(
        payload.conversation_id,
        payload.created_at,
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
      const hasAccess = await ensureConversationAccess({
        membershipService: this.membershipService,
        logger: this.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        action: 'delete',
        messageId: payload.message_id,
      });
      if (!hasAccess) {
        return;
      }

      const isOwner = await ensureMessageOwnership({
        repo: this.repo,
        logger: this.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        createdAt: payload.created_at,
        messageId: payload.message_id,
        action: 'delete',
      });
      if (!isOwner) {
        return;
      }

      await this.repo.softDeleteMessage(
        payload.conversation_id,
        payload.created_at,
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

      await this.emitMessageNotification(
        payload.conversation_id,
        payload.user_id,
        `Reacted with ${payload.reaction_type}`,
        payload.message_id,
        traceId,
      );
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
