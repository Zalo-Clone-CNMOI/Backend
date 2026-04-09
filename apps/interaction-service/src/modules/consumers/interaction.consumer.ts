import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { Inject } from '@nestjs/common';
import { KafkaTopics, type ChatMessageCreatedEvent } from '@libs/contracts';
import { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';

interface LastMessage {
  message_id: string;
  sender_id: string;
  body: string;
  created_at: number;
  has_attachments: boolean;
}

@Controller()
export class InteractionConsumer {
  private readonly logger = new Logger(InteractionConsumer.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

  @EventPattern(KafkaTopics.ChatMessageCreated)
  async onChatMessageCreated(
    @Payload() event: ChatMessageCreatedEvent,
  ): Promise<void> {
    const {
      message_id,
      conversation_id,
      sender_id,
      body,
      created_at,
      attachments,
    } = event;
    this.logger.log('🔥 RECEIVED EVENT', event);

    const key = `conversation:last:${conversation_id}`;

    try {
      const cached = await this.redis.get(key);
      let shouldUpdate = true;

      if (cached) {
        const parsed = JSON.parse(cached) as LastMessage;

        if (parsed.created_at >= created_at) {
          shouldUpdate = false;
        }
      }

      if (!shouldUpdate) {
        this.logger.debug(
          `Skip outdated message ${message_id} for conversation ${conversation_id}`,
        );
        return;
      }

      const lastMessage = {
        message_id,
        sender_id,
        body,
        created_at,
        has_attachments: !!attachments?.length,
      };
      this.logger.debug(
        `Latest message snapshot for ${conversation_id}: ${JSON.stringify(lastMessage)}`,
      );

      await this.redis.set(key, JSON.stringify(lastMessage));

      this.logger.log(
        `Updated lastMessage for conversation ${conversation_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process ChatMessageCreated for conversation ${conversation_id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
