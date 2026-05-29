import { Injectable, Logger, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
import type {
  ILlmProvider,
  LlmCompletionResult,
  LlmEmbeddingResult,
} from '../interfaces';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { total_tokens: number };
  model: string;
}

@Injectable()
export class VoyageAiProvider implements ILlmProvider {
  private readonly logger = new Logger(VoyageAiProvider.name);
  readonly name = 'voyageai';

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get isAvailable(): boolean {
    return !!this.config.voyageAiApiKey;
  }

  complete(): Promise<LlmCompletionResult> {
    return Promise.reject(
      new Error('Voyage AI does not support chat completions.'),
    );
  }

  completeStream(): Promise<LlmCompletionResult> {
    return Promise.reject(
      new Error('Voyage AI does not support chat completions.'),
    );
  }

  async embed(text: string, model?: string): Promise<LlmEmbeddingResult> {
    const results = await this.callApi([text], model);
    return results[0];
  }

  async embedBatch(
    texts: string[],
    model?: string,
  ): Promise<LlmEmbeddingResult[]> {
    if (texts.length === 0) return [];
    return this.callApi(texts, model);
  }

  private async callApi(
    inputs: string[],
    model?: string,
  ): Promise<LlmEmbeddingResult[]> {
    const embeddingModel = model ?? 'voyage-3';
    const response = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.voyageAiApiKey}`,
      },
      body: JSON.stringify({ input: inputs, model: embeddingModel }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(
        `Voyage AI embeddings failed: HTTP ${response.status} — ${body}`,
      );
      throw new Error(
        `Voyage AI API error ${response.status}: ${body || response.statusText}`,
      );
    }

    const data = (await response.json()) as VoyageEmbeddingResponse;
    const perChunkTokens = Math.round(data.usage.total_tokens / inputs.length);

    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => ({
        embedding: d.embedding,
        tokensUsed: perChunkTokens,
        model: data.model,
        provider: this.name,
      }));
  }
}
