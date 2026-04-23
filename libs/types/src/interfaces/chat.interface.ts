export type MessageAttachmentType = 'image' | 'video' | 'audio' | 'document';
export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';

export interface MessageAttachment {
  key: string;
  type: MessageAttachmentType;
  name: string;
  size: number;
  content_type: string;
  thumbnail_key?: string;
  visibility?: 'public' | 'private';
}

export interface PersistedMessage {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: number;
  attachments?: MessageAttachment[];
  reply_to_message_id?: string;
  edited_at?: number;
  deleted_at?: number;
  message_type?: string;
  system_event_type?: string;
  metadata?: Record<string, unknown>;
  forwarded_from?: {
    source_message_id: string;
    source_conversation_id: string;
    source_sender_id: string;
    source_sender_name_snapshot: string;
    source_created_at: number;
    source_type: 'text' | 'image' | 'file' | 'mixed';
  };
}

export interface MessageReaction {
  message_id: string;
  user_id: string;
  reaction_type: ReactionType;
  created_at: number;
}

export interface PinnedMessageRecord {
  conversation_id: string;
  message_id: string;
  created_at: number;
  pinned_by: string;
  pinned_at: number;
}

export interface CursorPaginationOptions {
  cursor?: string;
  limit?: number;
}

export interface CursorPaginatedResult<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
}
