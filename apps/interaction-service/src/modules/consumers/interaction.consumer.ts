import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { Inject } from '@nestjs/common';
import {
  KafkaTopics,
  type ChatMessageCreatedEvent,
  type ChatMessageUpdatedEvent,
  type ChatMessageDeletedEvent,
} from '@libs/contracts';
import { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '@libs/redis/redis.tokens';
import { Public } from '@app/decorator';

interface LastMessage {
  message_id: string;
  sender_id: string;
  body: string;
  created_at: number;
  has_attachments: boolean;
}

@Controller()
@Public()
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

    try {
      const cached = await this.getCachedLastMessage(conversation_id);
      let shouldUpdate = true;

      if (cached && cached.created_at >= created_at) {
        shouldUpdate = false;
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

      await this.setLastMessage(conversation_id, lastMessage);

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

  @EventPattern(KafkaTopics.ChatMessageUpdated)
  async onChatMessageUpdated(
    @Payload() event: ChatMessageUpdatedEvent,
  ): Promise<void> {
    const { message_id, conversation_id, body } = event;

    try {
      const cached = await this.getCachedLastMessage(conversation_id);

      if (!cached) {
        this.logger.debug(
          `Skip message update for conversation ${conversation_id}: no lastMessage snapshot`,
        );
        return;
      }

      if (cached.message_id !== message_id) {
        this.logger.debug(
          `Skip non-latest message update ${message_id} for conversation ${conversation_id}`,
        );
        return;
      }

      const updatedLastMessage: LastMessage = {
        ...cached,
        body,
      };

      await this.setLastMessage(conversation_id, updatedLastMessage);

      this.logger.log(
        `Updated edited lastMessage for conversation ${conversation_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process ChatMessageUpdated for conversation ${conversation_id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  @EventPattern(KafkaTopics.ChatMessageDeleted)
  async onChatMessageDeleted(
    @Payload() event: ChatMessageDeletedEvent,
  ): Promise<void> {
    const { message_id, conversation_id } = event;

    try {
      const cached = await this.getCachedLastMessage(conversation_id);

      if (!cached) {
        this.logger.debug(
          `Skip message delete for conversation ${conversation_id}: no lastMessage snapshot`,
        );
        return;
      }

      if (cached.message_id !== message_id) {
        this.logger.debug(
          `Skip non-latest message delete ${message_id} for conversation ${conversation_id}`,
        );
        return;
      }

      const deletedLastMessage: LastMessage = {
        ...cached,
        body: '',
        has_attachments: false,
      };

      await this.setLastMessage(conversation_id, deletedLastMessage);

      this.logger.log(
        `Updated deleted lastMessage for conversation ${conversation_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process ChatMessageDeleted for conversation ${conversation_id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private getLastMessageKey(conversationId: string): string {
    return `conversation:last:${conversationId}`;
  }

  private async getCachedLastMessage(
    conversationId: string,
  ): Promise<LastMessage | null> {
    const cached = await this.redis.get(this.getLastMessageKey(conversationId));

    if (!cached) {
      return null;
    }

    return this.parseCachedLastMessage(cached, conversationId);
  }

  private parseCachedLastMessage(
    cached: string,
    conversationId: string,
  ): LastMessage | null {
    try {
      return JSON.parse(cached) as LastMessage;
    } catch {
      this.logger.warn(
        `Invalid lastMessage cache for conversation ${conversationId}`,
      );
      return null;
    }
  }

  private async setLastMessage(
    conversationId: string,
    snapshot: LastMessage,
  ): Promise<void> {
    await this.redis.set(
      this.getLastMessageKey(conversationId),
      JSON.stringify(snapshot),
    );
  }
}
