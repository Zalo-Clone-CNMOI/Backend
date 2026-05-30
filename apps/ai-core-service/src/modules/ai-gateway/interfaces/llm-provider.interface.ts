export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; url: string; mime_type?: string };

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | LlmContentPart[];
}

export interface LlmCompletionOptions {
  model?: string;
  messages: LlmChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  responseFormat?: 'json_object';
}

export interface LlmCompletionResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  provider: string;
  latencyMs: number;
}

export interface LlmStreamChunk {
  content: string;
  index: number;
  isFinal: boolean;
}

export interface LlmEmbeddingResult {
  embedding: number[];
  tokensUsed: number;
  model: string;
  provider: string;
}

/**
 * Embedding input role. Some providers (Voyage AI) produce asymmetric vectors:
 * a chunk must be embedded as 'document' at ingest and the search text as
 * 'query'. Mismatching (or omitting) these collapses cosine similarity toward
 * zero — the root cause of the "topSimilarity≈0.08" doc-RAG failure. Providers
 * without the concept (OpenAI) ignore it.
 */
export type EmbeddingInputType = 'document' | 'query';

export interface ILlmProvider {
  readonly name: string;
  readonly isAvailable: boolean;

  complete(options: LlmCompletionOptions): Promise<LlmCompletionResult>;

  /**
   * Stream a completion. When `signal` is provided and fires mid-stream, the
   * provider stops emitting chunks and resolves with the partial result
   * collected so far — it MUST NOT throw on abort, so the gateway does not
   * fail over to another provider for an intentional cancel (Phase 6 C12).
   */
  completeStream(
    options: LlmCompletionOptions,
    onChunk: (chunk: LlmStreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<LlmCompletionResult>;

  embed(
    text: string,
    model?: string,
    inputType?: EmbeddingInputType,
  ): Promise<LlmEmbeddingResult>;

  embedBatch(
    texts: string[],
    model?: string,
    inputType?: EmbeddingInputType,
  ): Promise<LlmEmbeddingResult[]>;
}

export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');
