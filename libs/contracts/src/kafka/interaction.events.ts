export interface FriendRequestSentEvent {
  requestId: string;
  requesterId: string;
  addresseeId: string;
  requester: {
    id: string;
    fullName: string;
    avatarUrl: string | null;
    phone: string;
  };
  trace_id?: string;
}

export interface FriendRequestRespondedEvent {
  requestId: string;
  requesterId: string;
  addresseeId: string;
  status: 'accepted' | 'rejected';
  addressee?: {
    id: string;
    fullName: string;
    avatarUrl: string | null;
  };
  trace_id?: string;
}

export interface FriendRequestCancelledEvent {
  requestId: string;
  requesterId: string;
  addresseeId: string;
  trace_id?: string;
}

export interface FriendRemovedEvent {
  userId: string;
  friendId: string;
  trace_id?: string;
}

export interface ConversationPinnedEvent {
  userId: string;
  conversationId: string;
  pinnedAt: number;
  trace_id?: string;
}

export interface ConversationUnpinnedEvent {
  userId: string;
  conversationId: string;
  unpinnedAt: number;
}
export type ConversationMemberRole = 'owner' | 'admin' | 'member';

export interface ConversationMemberSnapshot {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  role: ConversationMemberRole;
}

export interface ConversationCreatedEvent {
  conversation_id: string;
  type: 'direct' | 'group';
  name: string | null;
  avatar_url: string | null;
  created_by: string;
  members: ConversationMemberSnapshot[];
  created_at: number;
  trace_id?: string;
}

export interface ConversationUpdatedEvent {
  conversation_id: string;
  updated_by: string;
  name: string | null;
  avatar_url: string | null;
  updated_at: number;
  trace_id?: string;
}

export interface ConversationDisbandedEvent {
  conversation_id: string;
  disbanded_by: string;
  member_ids: string[];
  disbanded_at: number;
  trace_id?: string;
}

export interface ConversationMemberAddedEvent {
  conversation_id: string;
  added_by: string;
  members: ConversationMemberSnapshot[];
  added_at: number;
  trace_id?: string;
}

export interface ConversationMemberRemovedEvent {
  conversation_id: string;
  removed_by: string;
  removed_user_id: string;
  removed_at: number;
  trace_id?: string;
}

export interface ConversationMemberRoleUpdatedEvent {
  conversation_id: string;
  updated_by: string;
  user_id: string;
  previous_role: ConversationMemberRole;
  current_role: ConversationMemberRole;
  updated_at: number;
  trace_id?: string;
}

export type GroupInviteStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export interface GroupInviteSentEvent {
  invite_id: string;
  conversation_id: string;
  inviter_id: string;
  invited_user_id: string;
  inviter_full_name: string;
  conversation_name: string | null;
  message: string | null;
  expires_at: number;
  sent_at: number;
  trace_id?: string;
}

export interface GroupInviteAcceptedEvent {
  invite_id: string;
  conversation_id: string;
  inviter_id: string;
  invited_user_id: string;
  status: 'accepted';
  responded_at: number;
  trace_id?: string;
}

export interface GroupInviteRejectedEvent {
  invite_id: string;
  conversation_id: string;
  inviter_id: string;
  invited_user_id: string;
  status: 'rejected';
  responded_at: number;
  trace_id?: string;
}

export interface GroupInviteCancelledEvent {
  invite_id: string;
  conversation_id: string;
  inviter_id: string;
  invited_user_id: string;
  status: 'cancelled';
  cancelled_at: number;
  trace_id?: string;
}

export interface GroupInviteExpiredEvent {
  invite_id: string;
  conversation_id: string;
  inviter_id: string;
  invited_user_id: string;
  status: 'expired';
  expired_at: number;
  trace_id?: string;
}

export interface ConversationPollCreatedEvent {
  poll_id: string;
  conversation_id: string;
  creator_id: string;
  question: string;
  options: Array<{ option_id: string; label: string; order_index: number }>;
  allow_multiple: boolean;
  allow_add_option: boolean;
  expires_at: number | null;
  created_at: number;
  message_id: string;
  trace_id: string;
}

export interface ConversationPollVoteCastEvent {
  poll_id: string;
  conversation_id: string;
  voter_id: string;
  option_ids_added: string[];
  option_ids_removed: string[];
  voted_at: number;
  trace_id: string;
}

export interface ConversationPollVoteRetractedEvent {
  poll_id: string;
  conversation_id: string;
  voter_id: string;
  retracted_at: number;
  trace_id: string;
}

export interface ConversationPollOptionAddedEvent {
  poll_id: string;
  conversation_id: string;
  option_id: string;
  label: string;
  order_index: number;
  added_by_user_id: string;
  added_at: number;
  trace_id: string;
}

export interface ConversationPollEditedEvent {
  poll_id: string;
  conversation_id: string;
  editor_user_id: string;
  changes: {
    question?: string;
    allow_multiple?: boolean;
    allow_add_option?: boolean;
    expires_at?: number | null;
    edited_option_labels?: Array<{ option_id: string; label: string }>;
  };
  edited_at: number;
  trace_id: string;
}

export interface ConversationPollOptionRemovedEvent {
  poll_id: string;
  conversation_id: string;
  option_id: string;
  removed_by_user_id: string;
  removed_at: number;
  trace_id: string;
}

export interface ConversationPollClosedEvent {
  poll_id: string;
  conversation_id: string;
  closed_by_user_id: string | null;
  reason: 'by_creator' | 'by_admin' | 'expired';
  final_tally: Array<{ option_id: string; vote_count: number }>;
  closed_at: number;
  trace_id: string;
}
