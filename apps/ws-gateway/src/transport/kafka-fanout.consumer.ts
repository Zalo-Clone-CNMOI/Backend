import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type ChatMessageCreatedEvent,
  type PresenceUpdatedEvent,
} from '@libs/contracts';
import { ChatGateway } from '../socket/chat.gateway';

@Controller()
export class KafkaFanoutConsumer {
  constructor(private readonly gateway: ChatGateway) {}

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
      },
    );
  }

  @EventPattern(KafkaTopics.PresenceUpdated)
  onPresenceUpdated(@Payload() payload: PresenceUpdatedEvent) {
    // MVP: broadcast presence to all connected sockets
    this.gateway.broadcastToAll(WsEvents.PresenceUpdate, payload);
  }
}
