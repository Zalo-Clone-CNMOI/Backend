import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type ChatMessageCreatedEvent,
  type ChatMessageUpdatedEvent,
  type ChatMessageDeletedEvent,
  type ChatReactionAddedEvent,
  type ChatReactionRemovedEvent,
} from '@libs/contracts';
import { ChatGateway } from '../../socket/chat.gateway';

@Controller()
export class ChatFanoutConsumer {
  constructor(private readonly gateway: ChatGateway) {}

  /**
   * Handle Message Created event
   * Broadcast new message to conversation room
   */
  @EventPattern(KafkaTopics.ChatMessageCreated)
  onMessageCreated(@Payload() payload: ChatMessageCreatedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatMessage,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        created_at: payload.created_at,
        attachments: payload.attachments,
        reply_to_message_id: payload.reply_to_message_id,
        forwarded_from: payload.forwarded_from,
      },
    );
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
}
