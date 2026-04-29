import { Injectable, Inject, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from '@libs/kafka';
import { MessageRepository } from '@libs/scylla';
import { CacheService } from '@libs/redis';
import {
  KafkaTopics,
  type WsAiSmartReplyRequestPayload,
  type WsAiSummaryRequestPayload,
  type WsAiTranslateRequestPayload,
  type WsAiDocumentQueryRequestPayload,
  type AiSmartReplyContextMessage,
} from '@libs/contracts';
import type { Socket } from 'socket.io';
import type { DefaultEventsMap } from 'socket.io/dist/typed-events';

type SocketData = { userId?: string };
type AuthedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

const DEFAULT_CONTEXT_COUNT = 10;
const DEFAULT_SUMMARY_MESSAGE_COUNT = 50;

@Injectable()
export class AiHandler {
  private readonly logger = new Logger(AiHandler.name);

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka,
    private readonly messageRepo: MessageRepository,
    private readonly cacheService: CacheService,
  ) {}

  async handleSmartReply(
    socket: AuthedSocket,
    body: WsAiSmartReplyRequestPayload,
  ) {
    const userId = String(socket.data.userId);
    const limit = body.context_count ?? DEFAULT_CONTEXT_COUNT;

    const contextMessages = await this.fetchContextMessages(
      body.conversation_id,
      userId,
      limit,
    );

    void this.kafka.emit(KafkaTopics.AiSmartReplyRequest, {
      conversation_id: body.conversation_id,
      user_id: userId,
      last_message_id: body.last_message_id,
      last_message_body: body.last_message_body,
      context_count: body.context_count,
      context_messages: contextMessages,
      requested_at: Date.now(),
      trace_id: `ws:${socket.id}:ai-smart-reply`,
    });
  }

  async handleSummary(socket: AuthedSocket, body: WsAiSummaryRequestPayload) {
    const userId = String(socket.data.userId);
    const limit = body.message_count ?? DEFAULT_SUMMARY_MESSAGE_COUNT;

    const { bodies, ids } = await this.fetchMessagesWithIds(
      body.conversation_id,
      limit,
    );

    void this.kafka.emit(KafkaTopics.AiSummaryRequest, {
      conversation_id: body.conversation_id,
      user_id: userId,
      message_count: body.message_count,
      messages: bodies,
      message_ids: ids,
      requested_at: Date.now(),
      trace_id: `ws:${socket.id}:ai-summary`,
    });
  }

  handleTranslate(socket: AuthedSocket, body: WsAiTranslateRequestPayload) {
    const userId = String(socket.data.userId);
    void this.kafka.emit(KafkaTopics.AiTranslateRequest, {
      message_id: body.message_id,
      conversation_id: body.conversation_id,
      user_id: userId,
      body: body.body,
      source_language: body.source_language,
      target_language: body.target_language,
      requested_at: Date.now(),
      trace_id: `ws:${socket.id}:ai-translate`,
    });
  }

  handleDocumentQuery(
    socket: AuthedSocket,
    body: WsAiDocumentQueryRequestPayload,
  ) {
    const userId = String(socket.data.userId);
    void this.kafka.emit(KafkaTopics.AiDocumentQuery, {
      document_id: body.document_id,
      conversation_id: body.conversation_id,
      user_id: userId,
      query: body.query,
      top_k: body.top_k,
      requested_at: Date.now(),
      trace_id: `ws:${socket.id}:ai-doc-query`,
    });
  }

  // ── Private Helpers ──────────────────────────────────────────────────

  /**
   * Fetch recent messages as typed context for smart reply.
   * Maps sender_id to role: 'me' (current user) or 'them' (others).
   * Tries Redis cache first, falls back to ScyllaDB.
   */
  private async fetchContextMessages(
    conversationId: string,
    userId: string,
    limit: number,
  ): Promise<AiSmartReplyContextMessage[]> {
    try {
      const cached =
        await this.cacheService.getRecentMessages<
          Array<{ sender_id: string; body: string }>
        >(conversationId);

      if (cached && cached.length > 0) {
        return cached
          .slice(0, limit)
          .filter((m) => m.body)
          .map(
            (m) =>
              ({
                role: m.sender_id === userId ? 'me' : 'them',
                body: m.body,
              }) as AiSmartReplyContextMessage,
          );
      }

      const result = await this.messageRepo.getMessages(conversationId, {
        limit,
      });
      return result.items
        .filter((m) => m.body)
        .map(
          (m) =>
            ({
              role: m.sender_id === userId ? 'me' : 'them',
              body: m.body,
            }) as AiSmartReplyContextMessage,
        );
    } catch (error) {
      this.logger.error(
        `Failed to fetch messages for conversation ${conversationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return [];
    }
  }

  /**
   * Fetch recent message bodies AND their IDs for summary tracking.
   * Tries Redis cache first, falls back to ScyllaDB.
   */
  private async fetchMessagesWithIds(
    conversationId: string,
    limit: number,
  ): Promise<{ bodies: string[]; ids: string[] }> {
    try {
      const cached =
        await this.cacheService.getRecentMessages<
          Array<{ message_id: string; body: string }>
        >(conversationId);

      if (cached && cached.length > 0) {
        const slice = cached.slice(0, limit);
        return {
          bodies: slice.map((m) => m.body).filter(Boolean),
          ids: slice.map((m) => m.message_id).filter(Boolean),
        };
      }

      const result = await this.messageRepo.getMessages(conversationId, {
        limit,
      });

      return {
        bodies: result.items.map((m) => m.body).filter(Boolean),
        ids: result.items.map((m) => m.message_id).filter(Boolean),
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch messages for conversation ${conversationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { bodies: [], ids: [] };
    }
  }
}
