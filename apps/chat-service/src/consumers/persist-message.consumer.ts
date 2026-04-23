import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
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
  type ChatSystemMessageCommand,
  type ChatMessageForwardCommand,
  type AiModerationResultEvent,
} from '@libs/contracts';
import { MessageRepository } from '@libs/scylla';
import { CacheService } from '@libs/redis';
import { ConversationMembershipService } from '@libs/mvp-access';
import { ChatPublisher } from '../services/chat.publisher';
import {
  ensureConversationAccess,
  ensureMessageOwnership,
} from '../utils/access.helper';
import { SendMessageHandler } from './send-message.handler';
import { ModerationResultHandler } from './moderation-result.handler';
import { MessageConsumerSharedService } from './message-consumer-shared.service';

@Controller()
export class PersistMessageConsumer {
  constructor(
    private readonly repo: MessageRepository,
    private readonly publisher: ChatPublisher,
    private readonly cacheService: CacheService,
    private readonly membershipService: ConversationMembershipService,
    private readonly sendHandler: SendMessageHandler,
    private readonly moderationHandler: ModerationResultHandler,
    private readonly shared: MessageConsumerSharedService,
  ) {}

  @EventPattern(KafkaTopics.ChatMessageSend)
  async onSend(@Payload() payload: ChatMessageSendCommand) {
    return this.sendHandler.handle(payload);
  }

  @EventPattern(KafkaTopics.AiModerationResult)
  async onModerationResult(@Payload() payload: AiModerationResultEvent) {
    return this.moderationHandler.handle(payload);
  }

  @EventPattern(KafkaTopics.ChatSystemMessageCreated)
  async onSystemMessage(@Payload() payload: ChatSystemMessageCommand) {
    const traceId = payload.trace_id;

    // Idempotency: reuse existing pattern
    const acquired = await this.repo.tryBeginMessageProcessing(
      payload.message_id,
      payload.conversation_id,
      payload.created_at,
    );
    if (!acquired) {
      this.shared.logger.debug(
        `[${traceId}] System message already processed (idempotent)`,
      );
      return;
    }

    try {
      await this.repo.insertSystemMessage({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        message_type: payload.message_type,
        system_event_type: payload.system_event_type,
        metadata: payload.metadata,
        body: payload.body,
        created_at: payload.created_at,
      });

      await this.repo.markMessageStored(payload.message_id);

      // Invalidate recent messages cache
      await this.cacheService
        .invalidateRecentMessages(payload.conversation_id)
        .catch(() => {});

      this.shared.logger.log(
        `[${traceId}] System message persisted: ${payload.system_event_type}`,
      );
    } catch (error) {
      await this.repo
        .clearMessageProcessing(payload.message_id)
        .catch(() => {});
      throw error;
    }
  }

  @EventPattern(KafkaTopics.ChatMessageEdit)
  async onEdit(@Payload() payload: ChatMessageEditCommand) {
    const startTime = Date.now();
    const editedAt = payload.edited_at ?? startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;
    const createdAt = payload.created_at;

    this.shared.logger.debug(`[${traceId}] ChatMessageEdit started`, {
      messageId: payload.message_id,
      conversationId: payload.conversation_id,
      createdAt,
    });

    if (!this.shared.isValidEpochTimestamp(createdAt)) {
      this.shared.logPoisonPayload('ChatMessageEdit', traceId, {
        messageId: payload.message_id,
        conversationId: payload.conversation_id,
        createdAt,
        reason: 'missing_or_invalid_created_at',
      });
      return;
    }

    try {
      const hasAccess = await ensureConversationAccess({
        membershipService: this.membershipService,
        logger: this.shared.logger,
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
        logger: this.shared.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        createdAt,
        messageId: payload.message_id,
        action: 'edit',
      });
      if (!isOwner) {
        return;
      }

      await this.repo.updateMessageBody(
        payload.conversation_id,
        createdAt,
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
      this.shared.logger.log(`[${traceId}] ChatMessageUpdated event emitted`, {
        messageId: payload.message_id,
        duration: Date.now() - startTime,
      });

      await (async () => {
        try {
          await this.cacheService.invalidateRecentMessages(
            payload.conversation_id,
          );
        } catch (err) {
          this.shared.logger.error(
            `[${traceId}] Cache invalidation failed`,
            err,
          );
        }
      })();
    } catch (error) {
      if (this.shared.isNonRetryableBindError(error)) {
        this.shared.logPoisonPayload('ChatMessageEdit', traceId, {
          messageId: payload.message_id,
          conversationId: payload.conversation_id,
          createdAt,
          reason: 'non_retryable_bind_error',
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      this.shared.logger.error(`[${traceId}] ChatMessageEdit failed`, {
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
    const createdAt = payload.created_at;

    this.shared.logger.debug(`[${traceId}] ChatMessageDelete started`, {
      messageId: payload.message_id,
      conversationId: payload.conversation_id,
      createdAt,
    });

    if (!this.shared.isValidEpochTimestamp(createdAt)) {
      this.shared.logPoisonPayload('ChatMessageDelete', traceId, {
        messageId: payload.message_id,
        conversationId: payload.conversation_id,
        createdAt,
        reason: 'missing_or_invalid_created_at',
      });
      return;
    }

    try {
      const hasAccess = await ensureConversationAccess({
        membershipService: this.membershipService,
        logger: this.shared.logger,
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
        logger: this.shared.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        createdAt,
        messageId: payload.message_id,
        action: 'delete',
      });
      if (!isOwner) {
        return;
      }

      await this.repo.softDeleteMessage(
        payload.conversation_id,
        createdAt,
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
      this.shared.logger.log(`[${traceId}] ChatMessageDeleted event emitted`, {
        messageId: payload.message_id,
        duration: Date.now() - startTime,
      });

      await (async () => {
        try {
          await this.cacheService.invalidateRecentMessages(
            payload.conversation_id,
          );
        } catch (err) {
          this.shared.logger.error(
            `[${traceId}] Cache invalidation failed`,
            err,
          );
        }
      })();
    } catch (error) {
      if (this.shared.isNonRetryableBindError(error)) {
        this.shared.logPoisonPayload('ChatMessageDelete', traceId, {
          messageId: payload.message_id,
          conversationId: payload.conversation_id,
          createdAt,
          reason: 'non_retryable_bind_error',
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      this.shared.logger.error(`[${traceId}] ChatMessageDelete failed`, {
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

    this.shared.logger.debug(`[${traceId}] ChatReactionAdd started`, {
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
      this.shared.logger.log(`[${traceId}] ChatReactionAdded event emitted`, {
        duration: Date.now() - startTime,
      });

      await this.shared.emitMessageNotification(
        payload.conversation_id,
        payload.user_id,
        `Reacted with ${payload.reaction_type}`,
        payload.message_id,
        traceId,
      );
    } catch (error) {
      this.shared.logger.error(`[${traceId}] ChatReactionAdd failed`, {
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

    this.shared.logger.debug(`[${traceId}] ChatReactionRemove started`, {
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
      this.shared.logger.log(`[${traceId}] ChatReactionRemoved event emitted`, {
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.shared.logger.error(`[${traceId}] ChatReactionRemove failed`, {
        messageId: payload.message_id,
        userId: payload.user_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @EventPattern(KafkaTopics.ChatMessageForward)
  async onForward(@Payload() payload: ChatMessageForwardCommand) {
    const startTime = Date.now();
    const createdAt =
      Number.isFinite(payload.sent_at) && payload.sent_at > 0
        ? payload.sent_at
        : startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;

    this.shared.logger.debug(`[${traceId}] ChatMessageForward started`, {
      messageId: payload.message_id,
      conversationId: payload.conversation_id,
      senderId: payload.sender_id,
      forwardId: payload.forward_id,
    });

    try {
      const hasAccess = await ensureConversationAccess({
        membershipService: this.membershipService,
        logger: this.shared.logger,
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
        const existingState = await this.repo.getMessageProcessingState(
          payload.message_id,
        );
        this.shared.logger.debug(
          `[${traceId}] Forward message already processed (idempotent)`,
          {
            messageId: payload.message_id,
            status: existingState?.status ?? 'unknown',
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
        forwarded_from: payload.forwarded_from,
      });

      const event: ChatMessageCreatedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        created_at: createdAt,
        attachments: payload.attachments,
        forwarded_from: payload.forwarded_from,
        trace_id: traceId,
      };

      await this.publisher.emit(KafkaTopics.ChatMessageCreated, event);
      await this.repo.markMessageStored(payload.message_id);

      this.shared.logger.log(`[${traceId}] ChatMessageForward completed`, {
        messageId: payload.message_id,
        duration: Date.now() - startTime,
      });

      await this.sendHandler.handlePostMessagePersist({
        conversationId: payload.conversation_id,
        senderId: payload.sender_id,
        body: payload.body,
        messageId: payload.message_id,
        createdAt,
        traceId,
      });
    } catch (error) {
      await this.repo.clearMessageProcessing(payload.message_id).catch(() => {
        this.shared.logger.error(
          `[${traceId}] Failed to clear idempotency lock for forwarded message: ${payload.message_id}`,
        );
      });
      this.shared.logger.error(`[${traceId}] ChatMessageForward failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
