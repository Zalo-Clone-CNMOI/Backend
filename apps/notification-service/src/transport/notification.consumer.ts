import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  type NotificationRequestedEvent,
  type NotificationSentEvent,
} from '@libs/contracts';
import { NotificationProvider } from '../providers/notification.provider';
import { NotificationPublisher } from './notification.publisher';

@Controller()
export class NotificationConsumer {
  constructor(
    private readonly provider: NotificationProvider,
    private readonly publisher: NotificationPublisher,
  ) {}

  @EventPattern(KafkaTopics.NotificationRequested)
  async onRequested(@Payload() payload: NotificationRequestedEvent) {
    await this.provider.send({
      userId: payload.user_id,
      title: payload.title,
      body: payload.body,
      data: payload.data,
    });

    const sent: NotificationSentEvent = {
      provider: 'mock',
      channel: payload.channel,
      user_id: payload.user_id,
      sent_at: Date.now(),
      trace_id: payload.trace_id,
    };

    this.publisher.emit(KafkaTopics.NotificationSent, sent);
  }
}
