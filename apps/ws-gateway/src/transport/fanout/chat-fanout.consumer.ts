import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  KafkaTopics,
  WsEvents,
  type ChatMessageCreatedEvent,
  type ChatMessageUpdatedEvent,
  type ChatMessageDeletedEvent,
  type ChatMessagePinnedEvent,
  type ChatMessageUnpinnedEvent,
  type ChatReactionAddedEvent,
  type ChatReactionRemovedEvent,
} from '@libs/contracts';
import { FriendshipAccessService } from '@libs/mvp-access';
import { ConversationMember } from '@libs/database/entities';
import { IsNull, Repository } from 'typeorm';
import { ChatGateway } from '../../socket/chat.gateway';

@Controller()
export class ChatFanoutConsumer {
  constructor(
    private readonly gateway: ChatGateway,
    @InjectRepository(ConversationMember)
    private readonly conversationMemberRepo: Repository<ConversationMember>,
    private readonly friendshipAccess: FriendshipAccessService,
  ) {}

  @EventPattern(KafkaTopics.ChatMessageCreated)
  async onMessageCreated(@Payload() payload: ChatMessageCreatedEvent) {
    const base = {
      message_id: payload.message_id,
      conversation_id: payload.conversation_id,
      sender_id: payload.sender_id,
      body: payload.body,
      created_at: payload.created_at,
      attachments: payload.attachments,
      reply_to_message_id: payload.reply_to_message_id,
    };

    if (!payload.forwarded_from) {
      this.gateway.broadcastToConversation(
        payload.conversation_id,
        WsEvents.ChatMessage,
        base,
      );
      return;
    }

    const sourceSenderId = payload.forwarded_from.source_sender_id;
    const memberships = await this.conversationMemberRepo.find({
      where: {
        conversationId: payload.conversation_id,
        leftAt: IsNull(),
      },
      select: ['userId'],
    });

    const memberUserIds = [...new Set(memberships.map((m) => m.userId))];
    if (memberUserIds.length === 0) {
      return;
    }

    const friendSet = await this.friendshipAccess.getFriendSet(
      sourceSenderId,
      memberUserIds,
    );

    for (const userId of memberUserIds) {
      const canSeeSource = userId === sourceSenderId || friendSet.has(userId);
      this.gateway.emitToUser(userId, WsEvents.ChatMessage, {
        ...base,
        forwarded_from: canSeeSource ? payload.forwarded_from : undefined,
      });
    }
  }

  /**
   * Handle Message Updated event
   * Broadcast to conversation room
   */
  @EventPattern(KafkaTopics.ChatMessageUpdated)
  onMessageUpdated(@Payload() payload: ChatMessageUpdatedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatMessageUpdated,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        edited_at: payload.edited_at,
      },
    );
  }

  /**
   * Handle Message Deleted event
   * Broadcast to conversation room
   */
  @EventPattern(KafkaTopics.ChatMessageDeleted)
  onMessageDeleted(@Payload() payload: ChatMessageDeletedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatMessageDeleted,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        deleted_at: payload.deleted_at,
      },
    );
  }

  /**
   * Handle Reaction Added event
   * Broadcast to conversation room
   */
  @EventPattern(KafkaTopics.ChatReactionAdded)
  onReactionAdded(@Payload() payload: ChatReactionAddedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatReactionAdded,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        user_id: payload.user_id,
        reaction_type: payload.reaction_type,
        created_at: payload.created_at,
      },
    );
  }

  /**
   * Handle Reaction Removed event
   * Broadcast to conversation room
   */
  @EventPattern(KafkaTopics.ChatReactionRemoved)
  onReactionRemoved(@Payload() payload: ChatReactionRemovedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatReactionRemoved,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        user_id: payload.user_id,
      },
    );
  }

  /**
   * Handle Message Pinned event
   * Broadcast to conversation room
   */
  @EventPattern(KafkaTopics.ChatMessagePinned)
  onMessagePinned(@Payload() payload: ChatMessagePinnedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatMessagePinned,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        created_at: payload.created_at,
        pinned_by: payload.pinned_by,
        pinned_at: payload.pinned_at,
      },
    );
  }

  /**
   * Handle Message Unpinned event
   * Broadcast to conversation room
   */
  @EventPattern(KafkaTopics.ChatMessageUnpinned)
  onMessageUnpinned(@Payload() payload: ChatMessageUnpinnedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatMessageUnpinned,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        created_at: payload.created_at,
        unpinned_by: payload.unpinned_by,
        unpinned_at: payload.unpinned_at,
      },
    );
  }
}
