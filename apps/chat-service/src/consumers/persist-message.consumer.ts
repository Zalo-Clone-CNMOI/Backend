import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  type ChatMessageSendCommand,
  type ChatMessageCreatedEvent,
} from '@libs/contracts';
import { MessageRepository } from '@libs/scylla';
import { ChatPublisher } from '../services/chat.publisher';

@Controller()
export class PersistMessageConsumer {
  constructor(
    private readonly repo: MessageRepository,
    private readonly publisher: ChatPublisher,
  ) {}

  @EventPattern(KafkaTopics.ChatMessageSend)
  async onSend(@Payload() payload: ChatMessageSendCommand) {
    const createdAt = Date.now();

    const seen = await this.repo.wasMessageSeen(payload.message_id);
    if (seen) return;

    await this.repo.insertMessage({
      message_id: payload.message_id,
      conversation_id: payload.conversation_id,
      sender_id: payload.sender_id,
      body: payload.body,
      created_at: createdAt,
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
      trace_id: payload.trace_id,
    };

    this.publisher.emit(KafkaTopics.ChatMessageCreated, event);
  }
}
