import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  type ChatPollMessageCommand,
  type ChatPollMessageUpdatedEvent,
} from '@libs/contracts';
import { MessageRepository } from '@libs/scylla';
import { CacheService } from '@libs/redis';
import { MessageConsumerSharedService } from './message-consumer-shared.service';

@Controller()
export class PollMessageConsumer {
  constructor(
    private readonly repo: MessageRepository,
    private readonly cacheService: CacheService,
    private readonly shared: MessageConsumerSharedService,
  ) {}

  @EventPattern(KafkaTopics.ChatPollMessageCreated)
  async onPollMessageCreated(@Payload() payload: ChatPollMessageCommand) {
    const traceId = payload.trace_id;

    const acquired = await this.repo.tryBeginMessageProcessing(
      payload.message_id,
      payload.conversation_id,
      payload.created_at,
    );
    if (!acquired) {
      this.shared.logger.debug(
        `[${traceId}] Poll message already processed (idempotent)`,
      );
      return;
    }

    try {
      await this.repo.insertPollMessage({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        message_type: payload.message_type,
        metadata: payload.metadata as unknown as Record<string, unknown>,
        body: payload.body,
        created_at: payload.created_at,
      });

      await this.repo.markMessageStored(payload.message_id);

      await this.cacheService
        .invalidateRecentMessages(payload.conversation_id)
        .catch(() => {});

      this.shared.logger.log(`[${traceId}] Poll message persisted`);
    } catch (error) {
      await this.repo
        .clearMessageProcessing(payload.message_id)
        .catch(() => {});

      if (this.shared.isNonRetryableBindError(error)) {
        this.shared.logPoisonPayload('ChatPollMessage', traceId, {
          messageId: payload.message_id,
          conversationId: payload.conversation_id,
          createdAt: payload.created_at,
          reason: 'non_retryable_bind_error',
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      this.shared.logger.error(`[${traceId}] ChatPollMessage failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @EventPattern(KafkaTopics.ChatPollMessageUpdated)
  async onPollMessageUpdated(@Payload() payload: ChatPollMessageUpdatedEvent) {
    const traceId = payload.trace_id;

    try {
      const msgInfo = await this.repo.getMessageById(payload.message_id);
      if (!msgInfo) {
        this.shared.logger.warn(
          `[${traceId}] Poll message not found for update`,
          {
            messageId: payload.message_id,
          },
        );
        return;
      }

      await this.repo.updateMessageMetadata(
        msgInfo.conversation_id,
        msgInfo.created_at,
        payload.message_id,
        payload.metadata as unknown as Record<string, unknown>,
      );

      await this.cacheService
        .invalidateRecentMessages(msgInfo.conversation_id)
        .catch(() => {});

      this.shared.logger.log(`[${traceId}] Poll message metadata updated`);
    } catch (error) {
      this.shared.logger.error(`[${traceId}] ChatPollMessageUpdated failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
