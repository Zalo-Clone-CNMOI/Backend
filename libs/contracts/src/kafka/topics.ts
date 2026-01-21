export const KafkaTopics = {
  ChatMessageSend: 'chat.message.send',
  ChatMessageCreated: 'chat.message.created',

  PresenceConnect: 'presence.connect',
  PresenceDisconnect: 'presence.disconnect',
  PresenceHeartbeat: 'presence.heartbeat',
  PresenceUpdated: 'presence.updated',

  MediaUploadRequested: 'media.upload.requested',
  MediaUploaded: 'media.uploaded',

  NotificationRequested: 'notification.requested',
  NotificationSent: 'notification.sent',

  AuthQrConfirmed: 'auth.qr.confirmed',
  AuthQrRejected: 'auth.qr.rejected',

  SendFriendRequest: 'friend.request.send',
  RespondFriendRequest: 'friend.request.respond',
  CancelFriendRequest: 'friend.request.cancelled',
  FriendRemoved: 'friend.removed',
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];
