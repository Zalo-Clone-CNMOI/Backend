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
    const createdAt = Date.now();

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
      trace_id: payload.trace_id,
    };

    this.publisher.emit(KafkaTopics.ChatMessageCreated, event);
    this.logger.log(`Message persisted: ${payload.message_id}`);

    // Emit notification for conversation members (excluding sender)
    void this.emitMessageNotification(
      payload.conversation_id,
      payload.sender_id,
      payload.body,
      payload.message_id,
      payload.trace_id,
    );

    await this.cacheService.invalidateRecentMessages(payload.conversation_id);
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
  /**
   * Emit notification for new message to all conversation members except sender
   */
  private async emitMessageNotification(
    conversationId: string,
    senderId: string,
    messageBody: string,
    messageId: string,
    traceId?: string,
  ): Promise<void> {
    try {
      // Get all conversation members except sender
      const recipientIds = await getConversationMemberIds(
        this.conversationMemberRepo,
        conversationId,
      );
      const recipients = recipientIds.filter((id) => id !== senderId);

      if (recipients.length === 0) {
        return;
      }

      // Get sender name for notification title
      const senderName = await getUserDisplayName(this.userRepo, senderId);

      // Truncate message body for preview
      const preview =
        messageBody.length > 100
          ? `${messageBody.substring(0, 100)}...`
          : messageBody;

      // Emit notification for each recipient
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
          trace_id: traceId,
        };

        this.publisher.emit(KafkaTopics.NotificationRequested, notification);
      }

      this.logger.debug(
        `Notification emitted for ${recipients.length} recipients (message: ${messageId})`,
      );
    } catch (error) {
      // Don't fail message persistence if notification fails
      this.logger.error(
        `Failed to emit message notification: ${messageId}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
