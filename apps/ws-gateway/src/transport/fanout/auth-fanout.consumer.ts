import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type AuthQrConfirmedEvent,
  type AuthQrRejectedEvent,
} from '@libs/contracts';
import { ChatGateway } from '../../socket/chat.gateway';

@Controller()
export class AuthFanoutConsumer {
  constructor(private readonly gateway: ChatGateway) {}

  /**
   * Handle QR login confirmed event
   * Emit tokens to specific PC socket
   */
  @EventPattern(KafkaTopics.AuthQrConfirmed)
  onQrConfirmed(@Payload() payload: AuthQrConfirmedEvent) {
    void this.gateway.emitToSocket(payload.socketId, WsEvents.QrConfirmed, {
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
    void this.gateway.emitToSocket(payload.socketId, WsEvents.QrRejected, {
      sessionId: payload.sessionId,
      reason: payload.reason,
    });
  }
}
