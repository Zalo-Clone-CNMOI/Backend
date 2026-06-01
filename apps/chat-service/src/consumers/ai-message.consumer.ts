import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  type ChatAiMessageCommand,
  type ChatMessageCreatedEvent,
  type AiEntityDetectionRequestEvent,
} from '@libs/contracts';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { MessageRepository } from '@libs/scylla';
import { CacheService } from '@libs/redis';
import { ChatPublisher } from '../services/chat.publisher';

/**
 * Consumes chat.ai.message — Zai messages produced by ai-core-service.
 * Persists to ScyllaDB and re-emits as chat.message.created so that:
 *  - ws-gateway fans out to all conversation members
 *  - interaction-service updates Conversation.lastMessageId / lastMessageAt
 *
 * Trust boundary: rejects any payload where sender_id != config.zaiBotUserId.
 */
@Controller()
export class AiMessageConsumer {
  private readonly logger = new Logger(AiMessageConsumer.name);

  constructor(
    private readonly repo: MessageRepository,
    private readonly publisher: ChatPublisher,
    private readonly cacheService: CacheService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @EventPattern(KafkaTopics.ChatAiMessage)
  async onAiMessage(@Payload() payload: ChatAiMessageCommand): Promise<void> {
    const { trace_id: traceId, message_id, conversation_id } = payload;

    if (payload.sender_id !== this.config.zaiBotUserId) {
      this.logger.error(
        `[${traceId}] Rejected chat.ai.message with forged sender_id`,
        {
          messageId: message_id,
          conversationId: conversation_id,
          receivedSenderId: payload.sender_id,
        },
      );
      return; // poison-pill drop, no retry
    }

    const acquired = await this.repo.tryBeginMessageProcessing(
      message_id,
      conversation_id,
      payload.created_at,
    );
    if (!acquired) {
      this.logger.debug(
        `[${traceId}] Zai message already processed (idempotent skip)`,
        { messageId: message_id },
      );
      return;
    }

    try {
      await this.repo.insertMessage({
        message_id,
        conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        created_at: payload.created_at,
        attachments: payload.attachments,
      });

      const event: ChatMessageCreatedEvent = {
        message_id,
        conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        body_format: payload.body_format,
        created_at: payload.created_at,
        attachments: payload.attachments,
        trace_id: traceId,
      };
      await this.publisher.emit(KafkaTopics.ChatMessageCreated, event);

      // Entity detection for Zai replies. The human-message path
      // (send-message.handler) triggers this; the Zai path persists via a
      // separate topic, so detection must be fired here too or Zai replies
      // never get entity highlights. Fire-and-forget: detection must never
      // block or fail Zai persistence. Condition mirrors the human path
      // (send-message.handler.ts:445): only non-empty text bodies.
      if (payload.body?.trim()) {
        const entityEvent: AiEntityDetectionRequestEvent = {
          message_id,
          conversation_id,
          sender_id: payload.sender_id,
          body: payload.body,
          created_at: payload.created_at,
          trace_id: traceId,
        };
        void this.publisher
          .emit(KafkaTopics.AiEntityDetectionRequest, entityEvent)
          .catch((err) =>
            this.logger.warn(
              `[${traceId}] AiEntityDetectionRequest emit failed for Zai message ${message_id}`,
              { error: err instanceof Error ? err.message : String(err) },
            ),
          );
      }

      await this.repo.markMessageStored(message_id);

      // Fire-and-forget cache invalidation
      void this.cacheService
        .invalidateRecentMessages(conversation_id)
        .catch((err) => {
          this.logger.warn(
            `[${traceId}] Cache invalidation failed for Zai message`,
            { error: err instanceof Error ? err.message : String(err) },
          );
        });

      this.logger.log(`[${traceId}] Zai message persisted`, {
        messageId: message_id,
        conversationId: conversation_id,
      });
    } catch (error) {
      await this.repo.clearMessageProcessing(message_id).catch((err) => {
        this.logger.warn(
          `[${traceId}] Failed to clear processing lock for ${message_id}`,
          { error: err instanceof Error ? err.message : String(err) },
        );
      });
      this.logger.error(`[${traceId}] Failed to persist Zai message`, {
        messageId: message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
