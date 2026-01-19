import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type ChatMessageCreatedEvent,
  type PresenceUpdatedEvent,
  type AuthQrConfirmedEvent,
  type AuthQrRejectedEvent,
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

  /**
   * Handle QR login confirmed event
   * Emit tokens to specific PC socket
   */
  @EventPattern(KafkaTopics.AuthQrConfirmed)
  onQrConfirmed(@Payload() payload: AuthQrConfirmedEvent) {
    this.gateway.emitToSocket(payload.socketId, WsEvents.QrConfirmed, {
      sessionId: payload.sessionId,
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      expiresIn: payload.expiresIn,
      user: payload.user,
    });
  }

  /**
   * Handle QR login rejected event
   * Notify PC socket about rejection
   */
  @EventPattern(KafkaTopics.AuthQrRejected)
  onQrRejected(@Payload() payload: AuthQrRejectedEvent) {
    this.gateway.emitToSocket(payload.socketId, WsEvents.QrRejected, {
      sessionId: payload.sessionId,
      reason: payload.reason,
    });
  }
}
