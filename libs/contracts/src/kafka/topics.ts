export const KafkaTopics = {
  ChatMessageSend: 'chat.message.send',
  ChatMessageCreated: 'chat.message.created',
  ChatMessageEdit: 'chat.message.edit',
  ChatMessageUpdated: 'chat.message.updated',
  ChatMessageDelete: 'chat.message.delete',
  ChatMessageDeleted: 'chat.message.deleted',
  ChatReactionAdd: 'chat.reaction.add',
  ChatReactionAdded: 'chat.reaction.added',
  ChatReactionRemove: 'chat.reaction.remove',
  ChatReactionRemoved: 'chat.reaction.removed',

  PresenceConnect: 'presence.connect',
  PresenceDisconnect: 'presence.disconnect',
  PresenceHeartbeat: 'presence.heartbeat',
  PresenceUpdated: 'presence.updated',

  MediaUploadRequested: 'media.upload.requested',
  MediaUploaded: 'media.uploaded',
  MediaThumbnailGenerated: 'media.thumbnail.generated',

  NotificationRequested: 'notification.requested',
  NotificationBatch: 'notification.batch',
  NotificationSent: 'notification.sent',
  NotificationFailed: 'notification.failed',

  AuthQrConfirmed: 'auth.qr.confirmed',
  AuthQrRejected: 'auth.qr.rejected',

  SendFriendRequest: 'friend.request.send',
  RespondFriendRequest: 'friend.request.respond',
  CancelFriendRequest: 'friend.request.cancelled',
  FriendRemoved: 'friend.removed',

  // ── AI Core Topics ──────────────────────────────────────────────────
  AiModerationRequest: 'ai.moderation.request',
  AiModerationResult: 'ai.moderation.result',
  AiModerationEnforcement: 'ai.moderation.enforcement',
  AiSmartReplyRequest: 'ai.smart-reply.request',
  AiSmartReplyResult: 'ai.smart-reply.result',
  AiSummaryRequest: 'ai.summary.request',
  AiSummaryResult: 'ai.summary.result',
  AiTranslateRequest: 'ai.translate.request',
  AiTranslateResult: 'ai.translate.result',
  AiDocumentUpload: 'ai.document.upload',
  AiDocumentProcessed: 'ai.document.processed',
  AiDocumentQuery: 'ai.document.query',
  AiDocumentQueryResult: 'ai.document.query.result',
  AiStreamChunk: 'ai.stream.chunk',
  AiStreamComplete: 'ai.stream.complete',
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];
