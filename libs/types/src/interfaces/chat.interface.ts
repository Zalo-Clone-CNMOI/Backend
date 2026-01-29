export type MessageAttachmentType = 'image' | 'video' | 'audio' | 'document';
export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';

export interface MessageAttachment {
  key: string;
  type: MessageAttachmentType;
  name: string;
  size: number;
  content_type: string;
  thumbnail_key?: string;
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
}

export interface MessageReaction {
  message_id: string;
  user_id: string;
  reaction_type: ReactionType;
  created_at: number;
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
