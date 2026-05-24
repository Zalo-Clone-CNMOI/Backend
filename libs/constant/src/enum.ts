export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

export enum FriendshipStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  BLOCKED = 'blocked',
}

export enum ConversationType {
  DIRECT = 'direct',
  GROUP = 'group',
  AI_ASSISTANT = 'ai_assistant',
}

export enum UpdateMemberRoleDtoRoleEnum {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

export enum GroupInviteStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export enum PollStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
}

export enum PollClosedReason {
  BY_CREATOR = 'by_creator',
  BY_ADMIN = 'by_admin',
  EXPIRED = 'expired',
}

export enum CallType {
  AUDIO = 'audio',
  VIDEO = 'video',
}

export enum CallSessionStatus {
  COMPLETED = 'completed',
  MISSED = 'missed',
  REJECTED = 'rejected',
  TIMEOUT = 'timeout',
}

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  FILE = 'file',
  STICKER = 'sticker',
  INVITE = 'invite',
  USER = 'user',
  SYSTEM = 'system',
  POLL = 'poll',
}

export enum ReactionType {
  LIKE = 'like',
  LOVE = 'love',
  HAHA = 'haha',
  WOW = 'wow',
  SAD = 'sad',
  ANGRY = 'angry',
}

export enum PostVisibility {
  PUBLIC = 'public',
  FRIENDS = 'friends',
  ONLY_ME = 'only_me',
}

export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
}

export enum MediaStatus {
  PENDING = 'pending',
  UPLOADED = 'uploaded',
  DELETED = 'deleted',
}

export enum DevicePlatform {
  IOS = 'ios',
  ANDROID = 'android',
  WEB = 'web',
}

export enum NotificationChannel {
  PUSH = 'push',
  EMAIL = 'email',
  SMS = 'sms',
}

export enum NotificationProvider {
  FCM = 'fcm',
  APNS = 'apns',
  MOCK = 'mock',
}

export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
}

export enum PresenceStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  AWAY = 'away',
}

export type MediaFileStatus = 'pending' | 'uploaded' | 'deleted';
export type MediaVisibility = 'public' | 'private';
export type MemberRole = 'owner' | 'admin' | 'member';

export function inferMediaVisibility(contentType: string): MediaVisibility {
  if (contentType.startsWith('image/') || contentType.startsWith('video/')) {
    return 'public';
  }
  return 'private';
}

export enum AiFeature {
  MODERATION = 'moderation',
  SMART_REPLY = 'smart_reply',
  SUMMARY = 'summary',
  TRANSLATION = 'translation',
  DOCUMENT_ANALYSIS = 'document_analysis',
}

export enum ModerationLabel {
  CLEAN = 'clean',
  SPAM = 'spam',
  TOXIC = 'toxic',
  HARASSMENT = 'harassment',
  HATE_SPEECH = 'hate_speech',
  SEXUAL = 'sexual',
  VIOLENCE = 'violence',
  SELF_HARM = 'self_harm',
}

export enum DocumentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum AiProvider {
  OPENAI = 'openai',
  GEMINI = 'gemini',
  ANTHROPIC = 'anthropic',
}
