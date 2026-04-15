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
  last_event_at?: number;
  last_event_type?: 'created' | 'updated' | 'deleted';
}

@Controller()
@Public()
export class InteractionConsumer {
  private readonly logger = new Logger(InteractionConsumer.name);

  private static readonly EVENT_PRECEDENCE = {
    created: 0,
    updated: 1,
    deleted: 2,
  } as const;

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
    this.logger.debug(
      `Received ChatMessageCreated ${message_id} for conversation ${conversation_id} at ${created_at}`,
    );

    try {
      const cached = await this.getCachedLastMessage(conversation_id);

      if (cached && !this.shouldApplyEvent(cached, created_at, 'created')) {
        this.logger.debug(
          `Skip outdated message ${message_id} for conversation ${conversation_id}`,
        );
        return;
      }

      const lastMessage: LastMessage = {
        message_id,
        sender_id,
        body,
        created_at,
        has_attachments: !!attachments?.length,
        last_event_at: created_at,
        last_event_type: 'created',
      };
      this.logger.debug(
        `Latest message snapshot updated: conversation=${conversation_id}, message=${message_id}, created_at=${created_at}, event=created`,
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
    const { message_id, conversation_id, body, edited_at } = event;

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

      if (!this.shouldApplyEvent(cached, edited_at, 'updated')) {
        this.logger.debug(
          `Skip stale message update ${message_id} for conversation ${conversation_id}`,
        );
        return;
      }

      const updatedLastMessage: LastMessage = {
        ...cached,
        body,
        last_event_at: edited_at,
        last_event_type: 'updated',
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
    const { message_id, conversation_id, deleted_at } = event;

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

      if (!this.shouldApplyEvent(cached, deleted_at, 'deleted')) {
        this.logger.debug(
          `Skip stale message delete ${message_id} for conversation ${conversation_id}`,
        );
        return;
      }

      const deletedLastMessage: LastMessage = {
        ...cached,
        body: '',
        has_attachments: false,
        last_event_at: deleted_at,
        last_event_type: 'deleted',
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
    const key = this.getLastMessageKey(conversationId);
    const cached = await this.redis.get(key);

    if (!cached) {
      return null;
    }

    const parsed = this.parseCachedLastMessage(cached, conversationId);
    if (!parsed) {
      try {
        await this.redis.del(key);
        this.logger.debug(
          `Cleared invalid lastMessage cache for conversation ${conversationId}`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to clear invalid lastMessage cache for conversation ${conversationId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return parsed;
  }

  private parseCachedLastMessage(
    cached: string,
    conversationId: string,
  ): LastMessage | null {
    try {
      const parsed: unknown = JSON.parse(cached);
      if (!this.isValidLastMessage(parsed)) {
        this.logger.warn(
          `Invalid lastMessage cache shape for conversation ${conversationId}`,
        );
        return null;
      }

      return parsed;
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

  private getLastEventTimestamp(snapshot: LastMessage): number {
    return snapshot.last_event_at ?? snapshot.created_at;
  }

  private getLastEventType(
    snapshot: LastMessage,
  ): NonNullable<LastMessage['last_event_type']> {
    return snapshot.last_event_type ?? 'created';
  }

  private shouldApplyEvent(
    snapshot: LastMessage,
    incomingAt: number,
    incomingType: NonNullable<LastMessage['last_event_type']>,
  ): boolean {
    const lastAt = this.getLastEventTimestamp(snapshot);

    if (incomingAt > lastAt) {
      return true;
    }

    if (incomingAt < lastAt) {
      return false;
    }

    const currentType = this.getLastEventType(snapshot);
    return (
      InteractionConsumer.EVENT_PRECEDENCE[incomingType] >
      InteractionConsumer.EVENT_PRECEDENCE[currentType]
    );
  }

  private isValidLastMessage(value: unknown): value is LastMessage {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const parsed = value as Partial<LastMessage>;

    const validEventType =
      parsed.last_event_type === undefined ||
      parsed.last_event_type === 'created' ||
      parsed.last_event_type === 'updated' ||
      parsed.last_event_type === 'deleted';

    const validLastEventAt =
      parsed.last_event_at === undefined ||
      typeof parsed.last_event_at === 'number';

    return (
      typeof parsed.message_id === 'string' &&
      typeof parsed.sender_id === 'string' &&
      typeof parsed.body === 'string' &&
      typeof parsed.created_at === 'number' &&
      typeof parsed.has_attachments === 'boolean' &&
      validLastEventAt &&
      validEventType
    );
  }
}
