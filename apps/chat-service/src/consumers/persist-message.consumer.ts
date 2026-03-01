import { Controller, Logger } from '@nestjs/common';
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
  type AiModerationRequestEvent,
} from '@libs/contracts';
import { MessageRepository } from '@libs/scylla';
import { CacheService } from '@libs/redis';
import { ConversationMembershipService } from '@libs/mvp-access';
import { ChatPublisher } from '../services/chat.publisher';

@Controller()
export class PersistMessageConsumer {
  private readonly logger = new Logger(PersistMessageConsumer.name);

  constructor(
    private readonly repo: MessageRepository,
    private readonly publisher: ChatPublisher,
    private readonly cacheService: CacheService,
    private readonly membershipService: ConversationMembershipService,
  ) {}

  @EventPattern(KafkaTopics.ChatMessageSend)
  async onSend(@Payload() payload: ChatMessageSendCommand) {
    const traceId = payload.trace_id ?? payload.message_id;
    const startTime = Date.now();
    const createdAt = startTime;

    try {
      // Authorization: Verify sender is member of conversation
      const canAccess = await this.membershipService.canUserAccessConversation(
        payload.sender_id,
        payload.conversation_id,
      );
      if (!canAccess) {
        this.logger.warn(
          `Unauthorized message attempt: user ${payload.sender_id} -> conversation ${payload.conversation_id}`,
        );
        return;
      }

      const seen = await this.repo.wasMessageSeen(payload.message_id);
      if (seen) return;

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

      void this.publisher.emit(KafkaTopics.ChatMessageCreated, event);
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
    const editedAt = payload.edited_at ?? Date.now();

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
      trace_id: payload.trace_id,
    };

    this.publisher.emit(KafkaTopics.ChatMessageUpdated, event);
    this.logger.log(`Message edited: ${payload.message_id}`);

    await this.cacheService.invalidateRecentMessages(payload.conversation_id);
  }

  @EventPattern(KafkaTopics.ChatMessageDelete)
  async onDelete(@Payload() payload: ChatMessageDeleteCommand) {
    const deletedAt = payload.deleted_at ?? Date.now();

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
      trace_id: payload.trace_id,
    };

    this.publisher.emit(KafkaTopics.ChatMessageDeleted, event);
    this.logger.log(`Message deleted: ${payload.message_id}`);

    await this.cacheService.invalidateRecentMessages(payload.conversation_id);
  }

  @EventPattern(KafkaTopics.ChatReactionAdd)
  async onReactionAdd(@Payload() payload: ChatReactionAddCommand) {
    const createdAt = payload.created_at ?? Date.now();

    const existingReaction = await this.repo.getReactionsByUser(
      payload.message_id,
      payload.user_id,
    );

    if (existingReaction) {
      await this.repo.removeReaction(payload.message_id, payload.user_id);
    }

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
      trace_id: payload.trace_id,
    };

    this.publisher.emit(KafkaTopics.ChatReactionAdded, event);
    this.logger.log(
      `Reaction added: ${payload.reaction_type} on ${payload.message_id}`,
    );
  }

  @EventPattern(KafkaTopics.ChatReactionRemove)
  async onReactionRemove(@Payload() payload: ChatReactionRemoveCommand) {
    await this.repo.removeReaction(payload.message_id, payload.user_id);

    const event: ChatReactionRemovedEvent = {
      message_id: payload.message_id,
      conversation_id: payload.conversation_id,
      user_id: payload.user_id,
      trace_id: payload.trace_id,
    };

    this.publisher.emit(KafkaTopics.ChatReactionRemoved, event);
    this.logger.log(`Reaction removed from ${payload.message_id}`);
  }
}
