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

export interface ILlmProvider {
  readonly name: string;
  readonly isAvailable: boolean;

  complete(options: LlmCompletionOptions): Promise<LlmCompletionResult>;

  completeStream(
    options: LlmCompletionOptions,
    onChunk: (chunk: LlmStreamChunk) => void,
  ): Promise<LlmCompletionResult>;

  embed(text: string, model?: string): Promise<LlmEmbeddingResult>;

  embedBatch(texts: string[], model?: string): Promise<LlmEmbeddingResult[]>;
}

export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');
