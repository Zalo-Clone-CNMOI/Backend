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
