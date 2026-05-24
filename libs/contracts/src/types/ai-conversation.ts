/**
 * All AI message feature kinds. Each AI engine that produces messages tags
 * them with one of these so frontend can render appropriate affordances.
 */
export type AiMessageFeature =
  | 'document'
  | 'translation'
  | 'summary'
  | 'general';

/**
 * Subset of AiMessageFeature that can anchor an entire AI_ASSISTANT
 * conversation. Translation and summary are per-message features, not
 * conversation-level — so they're excluded here.
 */
export type AiConversationFeature = Extract<
  AiMessageFeature,
  'document' | 'general'
>;

/**
 * Stored in Conversation.aiContext (JSONB). Read by AI orchestrators in later
 * phases to decide which engine handles user messages in this conversation.
 */
export interface AiConversationContext {
  feature: AiConversationFeature;
  document_id?: string;
  created_at: number;
}
