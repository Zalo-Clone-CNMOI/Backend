export const WsEvents = {
  ChatJoin: 'chat:join',
  ChatLeave: 'chat:leave',
  ChatSend: 'chat:send',
  ChatMessage: 'chat:message',
  ChatEdit: 'chat:edit',
  ChatMessageUpdated: 'chat:message:updated',
  ChatDelete: 'chat:delete',
  ChatMessageDeleted: 'chat:message:deleted',
  ChatReact: 'chat:react',
  ChatUnreact: 'chat:unreact',
  ChatReactionAdded: 'chat:reaction:added',
  ChatReactionRemoved: 'chat:reaction:removed',
  ChatTyping: 'chat:typing',
  ChatTypingUpdate: 'chat:typing:update',

  PresenceHeartbeat: 'presence:heartbeat',
  PresenceUpdate: 'presence:update',

  ChatAck: 'chat:ack',

  QrConfirmed: 'qr:confirmed',
  QrRejected: 'qr:rejected',
  QrBindRequest: 'qr:bind:request',
  QrBindIssued: 'qr:bind:issued',

  SendFriendRequest: 'friend:request:send',
  RespondFriendRequest: 'friend:request:respond',
  CancelFriendRequest: 'friend:request:cancel',
  FriendRemoved: 'friend:removed',

  // ── Notification Events ─────────────────────────────────────────────
  NotificationSent: 'notification:sent',
  NotificationFailed: 'notification:failed',

  // ── Error Events ───────────────────────────────────────────────────
  WsError: 'ws:error',

  // ── AI Events ──────────────────────────────────────────────────────
  AiSmartReplyRequest: 'ai:smart-reply:request',
  AiSmartReplyResult: 'ai:smart-reply:result',
  AiSummaryRequest: 'ai:summary:request',
  AiSummaryResult: 'ai:summary:result',
  AiTranslateRequest: 'ai:translate:request',
  AiTranslateResult: 'ai:translate:result',
  AiModerationResult: 'ai:moderation:result',
  AiModerationEnforcement: 'ai:moderation:enforcement',
  AiDocumentQueryRequest: 'ai:document:query:request',
  AiDocumentQueryResult: 'ai:document:query:result',
  AiStreamChunk: 'ai:stream:chunk',
  AiStreamComplete: 'ai:stream:complete',
} as const;

export type WsEventName = (typeof WsEvents)[keyof typeof WsEvents];

/**
 * Standardized WS error envelope — emitted on `ws:error` for all auth/authz
 * rejections and unhandled handler exceptions. Mirrors the HTTP envelope's
 * `error.code` / `error.message` fields for client-side symmetry.
 */
export interface WsErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  timestamp?: string;
}

export interface WsChatJoinPayload {
  conversation_id: string;
}

export interface WsMessageAttachment {
  key: string;
  type: 'image' | 'video' | 'audio' | 'document';
  name: string;
  size: number;
  content_type: string;
  thumbnail_key?: string;
  visibility?: 'public' | 'private';
}

export interface WsChatSendPayload {
  message_id: string;
  conversation_id: string;
  body: string;
  sent_at: number;
  attachments?: WsMessageAttachment[];
  reply_to_message_id?: string;
}

export interface WsChatMessagePayload {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: number;
  attachments?: WsMessageAttachment[];
  reply_to_message_id?: string;
}

export interface WsChatEditPayload {
  message_id: string;
  conversation_id: string;
  new_body: string;
  created_at: number;
}

export interface WsChatMessageUpdatedPayload {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  edited_at: number;
}

export interface WsChatDeletePayload {
  message_id: string;
  conversation_id: string;
  created_at: number;
}

export interface WsChatMessageDeletedPayload {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  deleted_at: number;
}

export interface WsChatReactPayload {
  message_id: string;
  conversation_id: string;
  reaction_type: 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';
}

export interface WsChatUnreactPayload {
  message_id: string;
  conversation_id: string;
}

export interface WsChatReactionAddedPayload {
  message_id: string;
  conversation_id: string;
  user_id: string;
  reaction_type: 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';
}

export interface WsChatReactionRemovedPayload {
  message_id: string;
  conversation_id: string;
  user_id: string;
}

export interface WsChatTypingPayload {
  conversation_id: string;
  username: string;
}

export interface WsChatTypingUser {
  user_id: string;
  username: string;
}

export interface WsChatTypingUpdatePayload {
  conversation_id: string;
  users: WsChatTypingUser[];
}

export interface WsPresenceHeartbeatPayload {
  ts: number;
}

export interface WsPresenceUpdatePayload {
  user_id: string;
  status: 'online' | 'offline';
  last_seen_at: number;
  expires_at: number;
}

export interface WsChatAckPayload {
  message_id: string;
  status: 'accepted' | 'rejected';
  reason?: string;
}

// QR Code Login Payloads
export interface WsQrConfirmedPayload {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    phone: string;
    fullName: string;
    email?: string | null;
    avatarUrl?: string | null;
  };
}

export interface WsQrRejectedPayload {
  sessionId: string;
  reason: string;
}
export interface WsQrBindIssuedPayload {
  socketId: string;
  socketBindingToken: string;
  expiresInSeconds: number;
}

// Friend Request Payloads
export interface WsSendFriendRequestPayload {
  requestId: string;
  requester: {
    id: string;
    fullName: string;
    avatarUrl: string | null;
    phone: string;
  };
}

export interface WsRespondFriendRequestPayload {
  requestId: string;
  status: 'accepted' | 'rejected';
  addressee?: {
    id: string;
    fullName: string;
    avatarUrl: string | null;
  };
}

export interface WsCancelFriendRequestPayload {
  requestId: string;
  requesterId: string;
}

export interface WsFriendRemovedPayload {
  userId: string;
}

// ── Notification WebSocket Payloads ──────────────────────────────────────

export interface WsNotificationSentPayload {
  provider: string;
  channel: string;
  type?: string;
  success_count?: number;
  sent_at: number;
  trace_id?: string;
}

export interface WsNotificationFailedPayload {
  provider: string;
  channel: string;
  type?: string;
  error_code: string;
  error_message: string;
  retry_count: number;
  failed_at: number;
  trace_id?: string;
}

// ── AI WebSocket Payloads ──────────────────────────────────────────────

export interface WsAiSmartReplyRequestPayload {
  conversation_id: string;
  last_message_id: string;
  last_message_body: string;
  context_count?: number;
}

export interface WsAiSmartReplyResultPayload {
  conversation_id: string;
  suggestions: string[];
}

export interface WsAiSummaryRequestPayload {
  conversation_id: string;
  message_count?: number;
}

export interface WsAiSummaryResultPayload {
  conversation_id: string;
  summary: string;
  message_range: {
    from_message_id: string;
    to_message_id: string;
    count: number;
  };
  cached: boolean;
}

export interface WsAiTranslateRequestPayload {
  message_id: string;
  conversation_id: string;
  body: string;
  source_language?: string;
  target_language: string;
}

export interface WsAiTranslateResultPayload {
  message_id: string;
  conversation_id: string;
  original_body: string;
  translated_body: string;
  source_language: string;
  target_language: string;
  cached: boolean;
}

export interface WsAiModerationResultPayload {
  message_id: string;
  conversation_id: string;
  is_flagged: boolean;
  labels: string[];
  confidence: number;
}

export interface WsAiModerationEnforcementPayload {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  action: 'none' | 'soft_delete';
  outcome:
    | 'not_flagged'
    | 'deleted'
    | 'already_deleted'
    | 'deduplicated'
    | 'failed';
  reason?: string;
  is_flagged: boolean;
  labels: string[];
  confidence: number;
  enforced_at: number;
}

export interface WsAiDocumentQueryRequestPayload {
  document_id: string;
  conversation_id: string;
  query: string;
  top_k?: number;
}

export interface WsAiDocumentQueryResultPayload {
  document_id: string;
  conversation_id: string;
  query: string;
  answer: string;
  sources: Array<{
    chunk_index: number;
    content_preview: string;
    similarity_score: number;
  }>;
}

export interface WsAiStreamChunkPayload {
  stream_id: string;
  conversation_id: string;
  feature: string;
  chunk_index: number;
  content: string;
  is_final: boolean;
}

export interface WsAiStreamCompletePayload {
  stream_id: string;
  conversation_id: string;
  feature: string;
  total_chunks: number;
}
