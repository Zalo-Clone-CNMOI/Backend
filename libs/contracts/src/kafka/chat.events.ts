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

export interface ForwardedFrom {
  source_message_id: string;
  source_conversation_id: string;
  source_sender_id: string;
  source_sender_name_snapshot: string;
  source_created_at: number;
  source_type: 'text' | 'image' | 'file' | 'mixed';
}

export interface ChatMessageForwardCommand {
  message_id: string; // target-specific UUID, BFF-generated
  conversation_id: string; // target conversation
  sender_id: string;
  sent_at: number;
  body: string; // original message body
  attachments?: MessageAttachment[]; // cloned keys from media-service
  forwarded_from: ForwardedFrom;
  forward_id: string; // idempotency across the whole forward operation
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
}

export interface ChatMessageCreatedEvent {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: number;
  attachments?: MessageAttachment[];
  reply_to_message_id?: string;
  forwarded_from?: ForwardedFrom;
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
