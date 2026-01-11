export interface ChatMessageSendCommand {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  sent_at: number; // epoch ms
  trace_id?: string;
}

export interface ChatMessageCreatedEvent {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: number; // epoch ms
  trace_id?: string;
}
