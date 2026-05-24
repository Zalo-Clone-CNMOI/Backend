// ── AI Core Service – Kafka Event Payloads ──────────────────────────────────

// ── Enums (re-exported from @app/constant for contract consumers) ──────────

export type AiFeatureType =
  | 'moderation'
  | 'smart_reply'
  | 'summary'
  | 'catch_up'
  | 'translation'
  | 'document_analysis'
  | 'entity_detection'
  | 'entity_info';

export type ModerationLabelType =
  | 'clean'
  | 'spam'
  | 'toxic'
  | 'harassment'
  | 'hate_speech'
  | 'sexual'
  | 'violence'
  | 'self_harm';

export type AiProviderType =
  | 'openai'
  | 'gemini'
  | 'anthropic'
  | 'locdo_router'
  | 'ensemble';

const AI_PROVIDER_VALUES: readonly AiProviderType[] = [
  'openai',
  'gemini',
  'anthropic',
  'locdo_router',
  'ensemble',
];

export function toAiProviderType(provider: string): AiProviderType {
  return (AI_PROVIDER_VALUES as readonly string[]).includes(provider)
    ? (provider as AiProviderType)
    : 'openai';
}

export type ModerationDecisionSourceType =
  | 'model'
  | 'fallback_provider_failure'
  | 'fallback_parse_failure';

export type ModerationEnforcementActionType = 'none' | 'soft_delete';

export type ModerationEnforcementOutcomeType =
  | 'not_flagged'
  | 'deleted'
  | 'already_deleted'
  | 'deduplicated'
  | 'failed';

export type ModerationEnforcementReasonType =
  | 'fallback_decision_source'
  | 'warn_only_mode'
  | 'below_confidence_threshold'
  | 'label_not_high_risk'
  | 'delete_event_already_emitted'
  | 'delete_event_already_emitted_after_lock_contention'
  | 'delete_event_already_emitted_after_lock_acquired'
  | 'message_not_found'
  | 'conditional_delete_not_applied'
  | 'delete_emit_lock_busy'
  | 'delete_emit_lock_lost_before_publish'
  | 'delete_emit_lock_renewal_failed'
  | 'chat_message_deleted_emit_failed'
  | 'dedup_marker_write_failed'
  | 'conditional_delete_applied'
  | 'message_was_already_deleted'
  | 'unexpected';

// ── Moderation ─────────────────────────────────────────────────────────────

export interface AiModerationRequestEvent {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  created_at: number;
  body: string;
  requested_at: number;
  trace_id?: string;
}

export interface AiModerationResultEvent {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  created_at: number;
  is_flagged: boolean;
  labels: ModerationLabelType[];
  confidence: number;
  provider: AiProviderType;
  ensemble: boolean;
  decision_source: ModerationDecisionSourceType;
  failure_reason?: string;
  processed_at: number;
  tokens_used: number;
  trace_id?: string;
}

export interface AiModerationEnforcementEvent {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  created_at: number;
  is_flagged: boolean;
  labels: ModerationLabelType[];
  confidence: number;
  provider: AiProviderType;
  action: ModerationEnforcementActionType;
  outcome: ModerationEnforcementOutcomeType;
  reason?: ModerationEnforcementReasonType;
  enforced_at: number;
  trace_id?: string;
}

// ── Smart Reply ────────────────────────────────────────────────────────────

export interface AiSmartReplyContextMessage {
  role: 'me' | 'them';
  body: string;
}

export interface AiSmartReplyRequestEvent {
  conversation_id: string;
  user_id: string;
  last_message_id: string;
  last_message_body: string;
  context_count?: number;
  context_messages: AiSmartReplyContextMessage[];
  requested_at: number;
  trace_id?: string;
}

export interface AiSmartReplyResultEvent {
  conversation_id: string;
  user_id: string;
  suggestions: string[];
  provider: AiProviderType;
  tokens_used: number;
  processed_at: number;
  trace_id?: string;
}

// ── Summary ────────────────────────────────────────────────────────────────

export interface AiSummaryRequestEvent {
  conversation_id: string;
  user_id: string;
  message_count?: number;
  messages: string[];
  message_ids: string[];
  requested_at: number;
  trace_id?: string;
}

export interface AiSummaryResultEvent {
  conversation_id: string;
  user_id: string;
  summary: string;
  message_range: {
    from_message_id: string;
    to_message_id: string;
    count: number;
  };
  provider: AiProviderType;
  tokens_used: number;
  cached: boolean;
  processed_at: number;
  trace_id?: string;
}

// ── Catch-up Summary ───────────────────────────────────────────────────────

/**
 * Result of a per-user "catch up on what you missed" summary. Returned
 * synchronously over HTTP (BFF → ai-core); NOT persisted as a chat message.
 * When had_unread is false, summary is empty and no LLM call was made.
 */
export interface AiCatchUpResultEvent {
  conversation_id: string;
  user_id: string;
  had_unread: boolean;
  summary: string;
  message_count: number;
  from_message_id?: string;
  to_message_id?: string;
  /** The lastReadAt boundary (epoch ms) used to bound the unread window, if any. */
  since?: number;
  /** True when unread messages exceeded the cap and only the newest were summarized. */
  truncated: boolean;
  provider: AiProviderType;
  tokens_used: number;
  cached: boolean;
  generated_at: number;
  trace_id?: string;
}

// ── Translation ────────────────────────────────────────────────────────────

export interface AiTranslateRequestEvent {
  message_id: string;
  conversation_id: string;
  user_id: string;
  body: string;
  source_language?: string;
  target_language: string;
  requested_at: number;
  trace_id?: string;
}

export interface AiTranslateResultEvent {
  message_id: string;
  conversation_id: string;
  user_id: string;
  original_body: string;
  translated_body: string;
  source_language: string;
  target_language: string;
  provider: AiProviderType;
  tokens_used: number;
  cached: boolean;
  processed_at: number;
  trace_id?: string;
}

// ── Document Analysis ──────────────────────────────────────────────────────

export interface AiDocumentUploadEvent {
  document_id: string;
  conversation_id: string;
  user_id: string;
  file_key: string;
  file_name: string;
  file_size: number;
  content_type: string;
  uploaded_at: number;
  trace_id?: string;
}

export interface AiDocumentProcessedEvent {
  document_id: string;
  conversation_id: string;
  user_id: string;
  status: 'completed' | 'failed';
  chunk_count: number;
  total_tokens: number;
  error_message?: string;
  processed_at: number;
  trace_id?: string;
}

export interface AiDocumentQueryEvent {
  document_id: string;
  conversation_id: string;
  user_id: string;
  query: string;
  top_k?: number;
  requested_at: number;
  trace_id?: string;
}

export interface AiDocumentQueryResultEvent {
  document_id: string;
  conversation_id: string;
  user_id: string;
  query: string;
  answer: string;
  sources: Array<{
    chunk_index: number;
    content_preview: string;
    similarity_score: number;
  }>;
  provider: AiProviderType;
  tokens_used: number;
  processed_at: number;
  trace_id?: string;
}

// ── Entity Detection ───────────────────────────────────────────────────────

export type EntityType =
  | 'tool'
  | 'company'
  | 'person'
  | 'concept'
  | 'location'
  | 'product'
  | 'other';

export interface DetectedEntity {
  text: string;
  type: EntityType;
  confidence: number;
}

export interface AiEntityDetectionRequestEvent {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: number;
  trace_id?: string;
}

export interface AiEntityDetectionResultEvent {
  message_id: string;
  conversation_id: string;
  entities: DetectedEntity[];
  provider: AiProviderType;
  tokens_used: number;
  processed_at: number;
  trace_id?: string;
}

export interface AiEntityInfoRequestEvent {
  entity_text: string;
  entity_type: EntityType;
  user_id: string;
  language?: string;
  trace_id?: string;
}

export interface AiEntityInfoResultEvent {
  entity_text: string;
  entity_type: EntityType;
  title: string;
  summary: string;
  details: string;
  related_entities?: string[];
  provider: AiProviderType;
  tokens_used: number;
  processed_at: number;
  trace_id?: string;
}

// ── Streaming ──────────────────────────────────────────────────────────────

export interface AiStreamChunkEvent {
  stream_id: string;
  user_id: string;
  conversation_id: string;
  feature: AiFeatureType;
  chunk_index: number;
  content: string;
  is_final: boolean;
  trace_id?: string;
}

export interface AiStreamCompleteEvent {
  stream_id: string;
  user_id: string;
  conversation_id: string;
  feature: AiFeatureType;
  total_chunks: number;
  total_tokens: number;
  provider: AiProviderType;
  completed_at: number;
  trace_id?: string;
}
