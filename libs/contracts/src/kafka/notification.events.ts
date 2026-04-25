// ── Notification Types ──────────────────────────────────────────────────

export enum NotificationType {
  ChatMessage = 'chat_message',
  FriendRequest = 'friend_request',
  FriendAccepted = 'friend_accepted',
  GroupInvite = 'group_invite',
  GroupInviteAccepted = 'group_invite_accepted',
  GroupInviteRejected = 'group_invite_rejected',
  GroupInviteCancelled = 'group_invite_cancelled',
  GroupPoll = 'group_poll',
  GroupPollClosed = 'group_poll_closed',
  Reaction = 'reaction',
  MissedCall = 'missed_call',
  System = 'system',
}

export type NotificationChannel = 'push';

export type NotificationProvider = 'fcm' | 'mock';

// ── Rich Notification ──────────────────────────────────────────────────

export interface RichNotificationPayload {
  image_url?: string;
  action_url?: string;
  category?: string;
  thread_id?: string;
  badge_count?: number;
  sound?: string;
  priority?: 'normal' | 'high';
  ttl_seconds?: number;
  collapse_key?: string;
}

// ── Commands ───────────────────────────────────────────────────────────

export interface NotificationRequestedEvent {
  channel: NotificationChannel;
  user_id: string;
  title: string;
  body: string;
  type?: NotificationType;
  data?: Record<string, string>;
  rich?: RichNotificationPayload;
  requested_at: number;
  trace_id?: string;
}

export interface NotificationBatchCommand {
  notifications: NotificationRequestedEvent[];
  batch_id: string;
  requested_at: number;
  trace_id?: string;
}

// ── Events ─────────────────────────────────────────────────────────────

export interface NotificationSentEvent {
  provider: NotificationProvider;
  channel: NotificationChannel;
  user_id: string;
  type?: NotificationType;
  success_count?: number;
  sent_at: number;
  trace_id?: string;
}

export interface NotificationFailedEvent {
  provider: NotificationProvider;
  channel: NotificationChannel;
  user_id: string;
  type?: NotificationType;
  error_code: string;
  error_message: string;
  retry_count: number;
  failed_at: number;
  trace_id?: string;
}
