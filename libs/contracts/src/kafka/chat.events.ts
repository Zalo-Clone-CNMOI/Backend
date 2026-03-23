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

export interface ChatMessageSendCommand {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  sent_at: number;
  attachments?: MessageAttachment[];
  reply_to_message_id?: string;
  trace_id?: string;
}

export interface ChatMessageCreatedEvent {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: number;
  attachments?: MessageAttachment[];
  reply_to_message_id?: string;
  trace_id?: string;
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
