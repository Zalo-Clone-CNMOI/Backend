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
  trace_id?: string;
}
