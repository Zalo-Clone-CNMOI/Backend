import { Controller, Inject } from '@nestjs/common';
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
  type AiZaiTypingEvent,
} from '@libs/contracts';
import { RedisService } from '@libs/redis';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { ChatGateway } from '../../socket/chat.gateway';
import { ActiveStreamTracker } from '../../socket/active-stream.tracker';
import {
  moderationStrikeKey,
  moderationCooldownKey,
} from '../../socket/throttle-keys';

@Controller()
export class AiFanoutConsumer {
  constructor(
    private readonly gateway: ChatGateway,
    private readonly streamTracker: ActiveStreamTracker,
    private readonly redisService: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

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

    // Fire-and-forget (with internal error swallowing) so a Redis failure can't
    // reject this handler and trigger Kafka redelivery → a duplicate broadcast.
    void this.recordModerationStrike(payload);
  }

  /**
   * Count actual message removals per sender in a fixed window; once the
   * threshold is hit, set a cooldown the ws-gateway send gate enforces. Only
   * `deleted` outcomes count (a flagged-but-not-removed message is not a
   * strike). Best-effort: any Redis error is swallowed.
   */
  private async recordModerationStrike(
    payload: AiModerationEnforcementEvent,
  ): Promise<void> {
    if (payload.outcome !== 'deleted') return;
    const userId = payload.sender_id;
    if (!userId) return;

    const threshold = this.config.moderationStrikeThreshold ?? 3;
    const windowSeconds = this.config.moderationStrikeWindowSeconds ?? 60;
    const cooldownSeconds = this.config.moderationCooldownSeconds ?? 30;

    try {
      const strikeKey = moderationStrikeKey(userId);
      const strikes = await this.redisService.incrBy(strikeKey, 1);
      if (strikes === 1) {
        await this.redisService.expire(strikeKey, windowSeconds);
      }
      if (strikes >= threshold) {
        await this.redisService.setEx(
          moderationCooldownKey(userId),
          cooldownSeconds,
          '1',
        );
        // Reset so the window starts fresh after the cooldown elapses.
        await this.redisService.del(strikeKey);
      }
    } catch {
      // best-effort — never disrupt the broadcast path
    }
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
   * Handle AI Stream Chunk.
   *
   * For Zai chat (feature='zai_chat'), broadcast to the whole conversation
   * room so all members of a group see Zai's reply stream in real time.
   * Previously only the user who triggered Zai saw the chunks, which felt
   * jarring for everyone else — typing indicator on, then full message
   * appears at once (Phase 4 audit C4).
   *
   * For all other features (smart_reply suggestions, document_analysis
   * answers, summary streams, etc.), keep the original unicast — those
   * are personal results and other group members should never see them.
   */
  @EventPattern(KafkaTopics.AiStreamChunk)
  onAiStreamChunk(@Payload() payload: AiStreamChunkEvent) {
    const dto = {
      stream_id: payload.stream_id,
      conversation_id: payload.conversation_id,
      feature: payload.feature,
      chunk_index: payload.chunk_index,
      content: payload.content,
      is_final: payload.is_final,
    };
    if (payload.feature === 'zai_chat') {
      // Track the stream against its conversation so the gateway can abort it
      // if the last recipient disconnects (Phase 6 C12).
      this.streamTracker.track(payload.stream_id, payload.conversation_id);
      this.gateway.broadcastToConversation(
        payload.conversation_id,
        WsEvents.AiStreamChunk,
        dto,
      );
    } else {
      this.gateway.emitToUser(payload.user_id, WsEvents.AiStreamChunk, dto);
    }
  }

  /**
   * Handle AI Stream Complete.
   *
   * Mirrors onAiStreamChunk: broadcast Zai's "stream finished" signal to
   * the conversation room so all group members exit the streaming state
   * at the same time as the user who triggered Zai. Other features stay
   * unicast.
   */
  @EventPattern(KafkaTopics.AiStreamComplete)
  onAiStreamComplete(@Payload() payload: AiStreamCompleteEvent) {
    const dto = {
      stream_id: payload.stream_id,
      conversation_id: payload.conversation_id,
      feature: payload.feature,
      total_chunks: payload.total_chunks,
    };
    if (payload.feature === 'zai_chat') {
      // Stream finished — stop tracking it (Phase 6 C12).
      this.streamTracker.complete(payload.stream_id);
      this.gateway.broadcastToConversation(
        payload.conversation_id,
        WsEvents.AiStreamComplete,
        dto,
      );
    } else {
      this.gateway.emitToUser(payload.user_id, WsEvents.AiStreamComplete, dto);
    }
  }

  /**
   * Handle Zai typing indicator.
   * Broadcast to the conversation room so all members see "Zai is typing…".
   */
  @EventPattern(KafkaTopics.AiZaiTyping)
  onAiZaiTyping(@Payload() payload: AiZaiTypingEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.AiZaiTyping,
      {
        conversation_id: payload.conversation_id,
        is_typing: payload.is_typing,
      },
    );
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
