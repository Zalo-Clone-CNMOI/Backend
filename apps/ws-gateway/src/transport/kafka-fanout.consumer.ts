import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  KafkaTopics,
  WsEvents,
  type ChatMessageCreatedEvent,
  type ChatMessageUpdatedEvent,
  type ChatMessageDeletedEvent,
  type ChatReactionAddedEvent,
  type ChatReactionRemovedEvent,
  type PresenceUpdatedEvent,
  type AuthQrConfirmedEvent,
  type AuthQrRejectedEvent,
  type FriendRequestSentEvent,
  type FriendRequestRespondedEvent,
  type FriendRequestCancelledEvent,
  type FriendRemovedEvent,
  type AiModerationResultEvent,
  type AiSmartReplyResultEvent,
  type AiSummaryResultEvent,
  type AiTranslateResultEvent,
  type AiDocumentProcessedEvent,
  type AiDocumentQueryResultEvent,
  type AiStreamChunkEvent,
  type AiStreamCompleteEvent,
} from '@libs/contracts';
import { ChatGateway } from '../socket/chat.gateway';

@Controller()
export class KafkaFanoutConsumer {
  constructor(private readonly gateway: ChatGateway) {}

  @EventPattern(KafkaTopics.ChatMessageCreated)
  onMessageCreated(@Payload() payload: ChatMessageCreatedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatMessage,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        created_at: payload.created_at,
      },
    );
  }

  @EventPattern(KafkaTopics.PresenceUpdated)
  onPresenceUpdated(@Payload() payload: PresenceUpdatedEvent) {
    // MVP: broadcast presence to all connected sockets
    this.gateway.broadcastToAll(WsEvents.PresenceUpdate, payload);
  }

  /**
   * Handle QR login confirmed event
   * Emit tokens to specific PC socket
   */
  @EventPattern(KafkaTopics.AuthQrConfirmed)
  onQrConfirmed(@Payload() payload: AuthQrConfirmedEvent) {
    void this.gateway.emitToSocket(payload.socketId, WsEvents.QrConfirmed, {
      sessionId: payload.sessionId,
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      expiresIn: payload.expiresIn,
      user: payload.user,
    });
  }

  /**
   * Handle QR login rejected event
   * Notify PC socket about rejection
   */
  @EventPattern(KafkaTopics.AuthQrRejected)
  onQrRejected(@Payload() payload: AuthQrRejectedEvent) {
    void this.gateway.emitToSocket(payload.socketId, WsEvents.QrRejected, {
      sessionId: payload.sessionId,
      reason: payload.reason,
    });
  }

  /**
   * Handle Send Friend Request event
   * Notify target user about new friend request
   */
  @EventPattern(KafkaTopics.SendFriendRequest)
  onSendFriendRequest(@Payload() payload: FriendRequestSentEvent) {
    void this.gateway.emitToSocket(
      payload.addresseeId,
      WsEvents.SendFriendRequest,
      {
        requestId: payload.requestId,
        requester: payload.requester as unknown,
      },
    );
  }

  /**
   * Handle Respond Friend Request event
   * Notify requester about the response to their friend request
   */
  @EventPattern(KafkaTopics.RespondFriendRequest)
  onRespondFriendRequest(@Payload() payload: FriendRequestRespondedEvent) {
    void this.gateway.emitToSocket(
      payload.requesterId,
      WsEvents.RespondFriendRequest,
      {
        requestId: payload.requestId,
        status: payload.status,
        addressee: payload.addressee,
      },
    );
  }

  /**
   * Handle Cancel Friend Request event
   * Notify addressee that the friend request was cancelled
   */
  @EventPattern(KafkaTopics.CancelFriendRequest)
  onCancelFriendRequest(@Payload() payload: FriendRequestCancelledEvent) {
    void this.gateway.emitToSocket(
      payload.addresseeId,
      WsEvents.CancelFriendRequest,
      {
        requestId: payload.requestId,
        requesterId: payload.requesterId,
      },
    );
  }

  /**
   * Handle Friend Removed event
   * Notify the other user that friendship was removed
   */
  @EventPattern(KafkaTopics.FriendRemoved)
  onFriendRemoved(@Payload() payload: FriendRemovedEvent) {
    void this.gateway.emitToSocket(payload.friendId, WsEvents.FriendRemoved, {
      userId: payload.userId,
    });
  }

  /**
   * Handle Message Updated event
   * Broadcast to conversation room
   */
  @EventPattern(KafkaTopics.ChatMessageUpdated)
  onMessageUpdated(@Payload() payload: ChatMessageUpdatedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatMessageUpdated,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        edited_at: payload.edited_at,
      },
    );
  }

  /**
   * Handle Message Deleted event
   * Broadcast to conversation room
   */
  @EventPattern(KafkaTopics.ChatMessageDeleted)
  onMessageDeleted(@Payload() payload: ChatMessageDeletedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatMessageDeleted,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        deleted_at: payload.deleted_at,
      },
    );
  }

  /**
   * Handle Reaction Added event
   * Broadcast to conversation room
   */
  @EventPattern(KafkaTopics.ChatReactionAdded)
  onReactionAdded(@Payload() payload: ChatReactionAddedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatReactionAdded,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        user_id: payload.user_id,
        reaction_type: payload.reaction_type,
        created_at: payload.created_at,
      },
    );
  }

  /**
   * Handle Reaction Removed event
   * Broadcast to conversation room
   */
  @EventPattern(KafkaTopics.ChatReactionRemoved)
  onReactionRemoved(@Payload() payload: ChatReactionRemovedEvent) {
    this.gateway.broadcastToConversation(
      payload.conversation_id,
      WsEvents.ChatReactionRemoved,
      {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        user_id: payload.user_id,
      },
    );
  }

  // ── AI Result Fanout ─────────────────────────────────────────────────

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
}
