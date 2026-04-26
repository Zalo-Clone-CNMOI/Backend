import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type AiModerationEnforcementEvent,
  type AiModerationResultEvent,
  type AiSmartReplyResultEvent,
  type AiSummaryResultEvent,
  type AiTranslateResultEvent,
  type AiDocumentProcessedEvent,
  type AiDocumentQueryResultEvent,
  type AiStreamChunkEvent,
  type AiStreamCompleteEvent,
  type AiEntityDetectionResultEvent,
} from '@libs/contracts';
import { ChatGateway } from '../../socket/chat.gateway';

@Controller()
export class AiFanoutConsumer {
  constructor(private readonly gateway: ChatGateway) {}

  /**
   * Handle AI Moderation Result
   * Notify sender about flagged content
   */
  @EventPattern(KafkaTopics.AiModerationResult)
  onAiModerationResult(@Payload() payload: AiModerationResultEvent) {
    if (payload.is_flagged) {
      this.gateway.emitToUser(payload.sender_id, WsEvents.AiModerationResult, {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        is_flagged: payload.is_flagged,
        labels: payload.labels,
        confidence: payload.confidence,
      });
    }
  }

  /**
   * Handle moderation enforcement outcomes.
   * Broadcast to conversation room for consistent moderation UX state.
   */
  @EventPattern(KafkaTopics.AiModerationEnforcement)
  onAiModerationEnforcement(@Payload() payload: AiModerationEnforcementEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.AiModerationEnforcement,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        action: payload.action,
        outcome: payload.outcome,
        reason: payload.reason,
        is_flagged: payload.is_flagged,
        labels: payload.labels,
        confidence: payload.confidence,
        enforced_at: payload.enforced_at,
      },
    );
  }

  /**
   * Handle AI Smart Reply Result
   * Send suggestions to requesting user
   */
  @EventPattern(KafkaTopics.AiSmartReplyResult)
  onAiSmartReplyResult(@Payload() payload: AiSmartReplyResultEvent) {
    this.gateway.emitToUser(payload.user_id, WsEvents.AiSmartReplyResult, {
      conversation_id: payload.conversation_id,
      suggestions: payload.suggestions,
    });
  }

  /**
   * Handle AI Summary Result
   * Send summary to requesting user
   */
  @EventPattern(KafkaTopics.AiSummaryResult)
  onAiSummaryResult(@Payload() payload: AiSummaryResultEvent) {
    this.gateway.emitToUser(payload.user_id, WsEvents.AiSummaryResult, {
      conversation_id: payload.conversation_id,
      summary: payload.summary,
      message_range: payload.message_range,
      cached: payload.cached,
    });
  }

  /**
   * Handle AI Translation Result
   * Send translation to requesting user
   */
  @EventPattern(KafkaTopics.AiTranslateResult)
  onAiTranslateResult(@Payload() payload: AiTranslateResultEvent) {
    this.gateway.emitToUser(payload.user_id, WsEvents.AiTranslateResult, {
      message_id: payload.message_id,
      conversation_id: payload.conversation_id,
      original_body: payload.original_body,
      translated_body: payload.translated_body,
      source_language: payload.source_language,
      target_language: payload.target_language,
      cached: payload.cached,
    });
  }

  /**
   * Handle AI Document Processed
   * Notify user that document processing is complete
   */
  @EventPattern(KafkaTopics.AiDocumentProcessed)
  onAiDocumentProcessed(@Payload() payload: AiDocumentProcessedEvent) {
    this.gateway.emitToUser(payload.user_id, WsEvents.AiStreamComplete, {
      stream_id: payload.document_id,
      conversation_id: payload.conversation_id,
      feature: 'document_analysis',
      total_chunks: payload.chunk_count,
    });
  }

  /**
   * Handle AI Document Query Result
   * Send RAG answer to requesting user
   */
  @EventPattern(KafkaTopics.AiDocumentQueryResult)
  onAiDocumentQueryResult(@Payload() payload: AiDocumentQueryResultEvent) {
    this.gateway.emitToUser(payload.user_id, WsEvents.AiDocumentQueryResult, {
      document_id: payload.document_id,
      conversation_id: payload.conversation_id,
      query: payload.query,
      answer: payload.answer,
      sources: payload.sources,
    });
  }

  /**
   * Handle AI Stream Chunk
   * Forward streaming chunk to user in real-time
   */
  @EventPattern(KafkaTopics.AiStreamChunk)
  onAiStreamChunk(@Payload() payload: AiStreamChunkEvent) {
    this.gateway.emitToUser(payload.user_id, WsEvents.AiStreamChunk, {
      stream_id: payload.stream_id,
      conversation_id: payload.conversation_id,
      feature: payload.feature,
      chunk_index: payload.chunk_index,
      content: payload.content,
      is_final: payload.is_final,
    });
  }

  /**
   * Handle AI Stream Complete
   * Notify user that streaming is finished
   */
  @EventPattern(KafkaTopics.AiStreamComplete)
  onAiStreamComplete(@Payload() payload: AiStreamCompleteEvent) {
    this.gateway.emitToUser(payload.user_id, WsEvents.AiStreamComplete, {
      stream_id: payload.stream_id,
      conversation_id: payload.conversation_id,
      feature: payload.feature,
      total_chunks: payload.total_chunks,
    });
  }

  /**
   * Handle Entity Detection Result.
   * Broadcast detected entities to the conversation room so all members
   * see the same highlights for a given message.
   */
  @EventPattern(KafkaTopics.AiEntityDetectionResult)
  onAiEntityDetectionResult(@Payload() payload: AiEntityDetectionResultEvent) {
    if (!payload.entities || payload.entities.length === 0) return;

    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.MessageEntities,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        entities: payload.entities,
      },
    );
  }
}
