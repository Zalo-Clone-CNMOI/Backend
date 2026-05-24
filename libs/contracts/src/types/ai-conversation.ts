/**
 * Stored in Conversation.aiContext (JSONB). Read by AI orchestrators in later
 * phases to decide which engine handles user messages in this conversation.
 */
export interface AiConversationContext {
  feature: 'document' | 'general';
  document_id?: string;
  created_at: number;
}
