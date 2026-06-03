import { MessageType } from '@app/constant';
import type { CallType } from './call.events';
import type { ModerationLabelType } from './ai.events';
import type {
  AiMessageFeature,
  MessageBodyFormat,
} from '../types/ai-conversation';

export type MessageAttachmentType = 'image' | 'video' | 'audio' | 'document';

export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';

export enum SystemEventType {
  MEMBER_ADDED = 'member_added',
  MEMBER_REMOVED = 'member_removed',
  MEMBER_LEFT = 'member_left',
  ROLE_CHANGED = 'role_changed',
  OWNER_TRANSFERRED = 'owner_transferred',
  GROUP_DISBANDED = 'group_disbanded',
  CALL_ENDED = 'call_ended',
  CALL_MISSED = 'call_missed',
}

export interface MemberAddedMetadata {
  added_by: string;
  added_by_name: string;
  added_members: Array<{ user_id: string; full_name: string }>;
}

export interface MemberRemovedMetadata {
  removed_by: string;
  removed_by_name: string;
  removed_user_id: string;
  removed_user_name: string;
}

export interface MemberLeftMetadata {
  user_id: string;
  user_name: string;
}

export interface RoleChangedMetadata {
  updated_by: string;
  updated_by_name: string;
  target_user_id: string;
  target_user_name: string;
  previous_role: string;
  new_role: string;
}

export interface OwnerTransferredMetadata {
  previous_owner_id: string;
  previous_owner_name: string;
  new_owner_id: string;
  new_owner_name: string;
}

export interface GroupDisbandedMetadata {
  disbanded_by: string;
  disbanded_by_name: string;
}

export interface CallEndedMetadata {
  call_id: string;
  call_type: CallType;
  initiator_id: string;
  duration_ms: number;
  started_at: number;
  ended_at: number;
}

export interface CallMissedMetadata {
  call_id: string;
  call_type: CallType;
  initiator_id: string;
  reason: 'timeout' | 'rejected' | 'missed';
  started_at: number;
  ended_at: number;
}

export interface InviteMessageMetadata {
  invite_id: string;
  group_id: string;
  group_name: string;
  inviter_id: string;
  inviter_name: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
}

export type SystemMessageMetadata =
  | MemberAddedMetadata
  | MemberRemovedMetadata
  | MemberLeftMetadata
  | RoleChangedMetadata
  | OwnerTransferredMetadata
  | GroupDisbandedMetadata
  | CallEndedMetadata
  | CallMissedMetadata;

export interface MessageAttachment {
  key: string;
  type: MessageAttachmentType;
  name: string;
  size: number;
  content_type: string;
  thumbnail_key?: string;
  visibility?: 'public' | 'private';
}

export interface MessageMention {
  user_id: string; // UUID of mentioned user, or '__ALL__' sentinel
  mention_type: 'user' | 'all';
  offset: number; // UTF-16 code unit offset into body
  length: number;
}

export const MENTION_ALL_SENTINEL = '__ALL__' as const;

export interface ForwardedFrom {
  source_message_id: string;
  source_conversation_id: string;
  source_sender_id: string;
  source_sender_name_snapshot: string;
  source_created_at: number;
  source_type: 'text' | 'image' | 'file' | 'mixed';
}

export interface ChatMessageForwardCommand {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  sent_at: number;
  body: string;
  attachments?: MessageAttachment[];
  forwarded_from: ForwardedFrom;
  forward_id: string;
  trace_id?: string;
}

export interface ChatMessageSendCommand {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  sent_at: number;
  attachments?: MessageAttachment[];
  reply_to_message_id?: string;
  trace_id?: string;
  mentions?: MessageMention[];
}

/**
 * Emitted by chat-service when a message-send is rejected BEFORE persistence
 * (Phase 5 pre-send moderation gate, or future rate-limit / auth checks).
 * Consumed by ws-gateway → forwarded to the original sender's socket as
 * `WsEvents.ChatMessageRejected` so the client can unhook its optimistic
 * bubble. Never persisted; the conversation has no row for this message_id.
 */
export interface ChatMessageRejectedEvent {
  /** Client-supplied id, used by FE to locate and remove the optimistic bubble. */
  message_id: string;
  conversation_id: string;
  sender_id: string;
  reason: 'moderation' | 'rate_limit' | 'unauthorized';
  /** Moderation labels (e.g. 'toxic', 'spam') when reason === 'moderation'. */
  labels?: ModerationLabelType[];
  /** Confidence in [0,1] the model assigned to the labels. */
  confidence?: number;
  rejected_at: number;
  trace_id?: string;
}

export interface ChatMessageCreatedEvent {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  /** Render-format hint for AI-authored messages. Undefined for human-authored messages (treated as text). */
  body_format?: MessageBodyFormat;
  created_at: number;
  attachments?: MessageAttachment[];
  reply_to_message_id?: string;
  forwarded_from?: ForwardedFrom;
  trace_id?: string;
  message_type?: string;
  mentions?: MessageMention[];
  /** Active member IDs at publish time. Required when forwarded_from is set so ws-gateway can fan out per-user visibility without querying DB. */
  member_ids?: string[];
}

export interface ChatSystemMessageCommand {
  message_id: string;
  conversation_id: string;
  message_type: MessageType.SYSTEM;
  system_event_type: SystemEventType;
  metadata: SystemMessageMetadata;
  body: string;
  created_at: number;
  trace_id: string;
}

export interface ChatSystemMessageCreatedEvent {
  message_id: string;
  conversation_id: string;
  message_type: MessageType.SYSTEM;
  system_event_type: SystemEventType;
  metadata: SystemMessageMetadata;
  body: string;
  created_at: number;
  trace_id: string;
}

export interface ChatInviteMessageCommand {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  message_type: MessageType.INVITE;
  metadata: InviteMessageMetadata;
  body: string;
  created_at: number;
  trace_id: string;
}

export interface ChatInviteMessageCreatedEvent {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  message_type: MessageType.INVITE;
  metadata: InviteMessageMetadata;
  body: string;
  created_at: number;
  trace_id: string;
}

export interface ChatInviteMessageUpdatedEvent {
  message_id: string;
  conversation_id: string;
  metadata: InviteMessageMetadata;
  trace_id: string;
}

export interface ChatMessageEditCommand {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  new_body: string;
  created_at: number;
  edited_at: number;
  trace_id?: string;
}

export interface ChatMessageUpdatedEvent {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  edited_at: number;
  trace_id?: string;
}

export interface ChatMessageDeleteCommand {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  created_at: number;
  deleted_at: number;
  trace_id?: string;
}

export interface ChatMessageDeletedEvent {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  deleted_at: number;
  trace_id?: string;
}

export interface ChatReactionAddCommand {
  message_id: string;
  conversation_id: string;
  user_id: string;
  reaction_type: ReactionType;
  created_at: number;
  trace_id?: string;
}

export interface ChatReactionAddedEvent {
  message_id: string;
  conversation_id: string;
  user_id: string;
  reaction_type: ReactionType;
  created_at: number;
  trace_id?: string;
}

export interface ChatReactionRemoveCommand {
  message_id: string;
  conversation_id: string;
  user_id: string;
  trace_id?: string;
}

export interface ChatReactionRemovedEvent {
  message_id: string;
  conversation_id: string;
  user_id: string;
  trace_id?: string;
}

export interface ChatMessagePinnedEvent {
  message_id: string;
  conversation_id: string;
  created_at: number;
  pinned_by: string;
  pinned_at: number;
  trace_id?: string;
}

export interface ChatMessageUnpinnedEvent {
  message_id: string;
  conversation_id: string;
  created_at: number;
  unpinned_by: string;
  unpinned_at: number;
  trace_id?: string;
}

export interface PollMessageMetadata {
  poll_id: string;
  question: string;
  options: Array<{
    option_id: string;
    label: string;
    order_index: number;
    vote_count: number;
  }>;
  total_votes: number;
  total_voters: number;
  allow_multiple: boolean;
  allow_add_option: boolean;
  status: 'active' | 'closed';
  expires_at: number | null;
  closed_at: number | null;
  closed_reason: 'by_creator' | 'by_admin' | 'expired' | null;
}

export interface ChatPollMessageCommand {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  message_type: 'poll';
  metadata: PollMessageMetadata;
  body: string;
  created_at: number;
  trace_id: string;
}

export interface ChatPollMessageUpdatedEvent {
  message_id: string;
  conversation_id: string;
  metadata: PollMessageMetadata;
  trace_id: string;
}

/**
 * Metadata attached to a Zai-produced message. Used by frontend to render
 * citations, debug tags, and feature-specific affordances.
 */
export interface AiMessageMetadata {
  feature: AiMessageFeature;
  sources?: Array<{ chunk_index: number; preview: string }>;
  tokens_used?: number;
  model?: string;
  parent_message_id?: string;
  /** Reserved for streaming UI in future phases; Phase 1 always omits. */
  is_streaming?: boolean;
}

/**
 * Kafka command sent from ai-core-service to chat-service to persist a Zai
 * message. `sender_id` MUST equal config.zaiBotUserId — enforced by consumer.
 */
export interface ChatAiMessageCommand {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  /** Render-format hint. Omit or use 'text' for plain text rendering. */
  body_format?: MessageBodyFormat;
  attachments?: MessageAttachment[];
  metadata?: AiMessageMetadata;
  created_at: number;
  trace_id: string;
}
