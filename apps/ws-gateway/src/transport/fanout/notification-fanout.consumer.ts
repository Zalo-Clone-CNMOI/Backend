import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type NotificationSentEvent,
  type NotificationFailedEvent,
} from '@libs/contracts';
import { ChatGateway } from '../../socket/chat.gateway';

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_TOKEN: 'Your device token is invalid. Please re-login.',
  TOKEN_EXPIRED: 'Your push token has expired. Please re-login.',
  RATE_LIMITED: 'Too many notifications. Please try again later.',
};

@Controller()
export class NotificationFanoutConsumer {
  constructor(private readonly gateway: ChatGateway) {}

  @EventPattern(KafkaTopics.NotificationSent)
  onNotificationSent(@Payload() payload: NotificationSentEvent) {
    void this.gateway.emitToUser(payload.user_id, WsEvents.NotificationSent, {
      provider: payload.provider,
      channel: payload.channel,
      type: payload.type,
      success_count: payload.success_count,
      sent_at: payload.sent_at,
      trace_id: payload.trace_id,
    });
  }

  @EventPattern(KafkaTopics.NotificationFailed)
  onNotificationFailed(@Payload() payload: NotificationFailedEvent) {
    void this.gateway.emitToUser(payload.user_id, WsEvents.NotificationFailed, {
      provider: payload.provider,
      channel: payload.channel,
      type: payload.type,
      error_code: payload.error_code,
      error_message:
        ERROR_MESSAGES[payload.error_code] ??
        'Notification delivery failed. Please try again.',
      retry_count: payload.retry_count,
      failed_at: payload.failed_at,
      trace_id: payload.trace_id,
    });
  }
}
