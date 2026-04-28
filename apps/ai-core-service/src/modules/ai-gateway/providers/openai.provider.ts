import { Injectable, Logger, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
import type OpenAI from 'openai';
import {
  ILlmProvider,
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmStreamChunk,
  LlmEmbeddingResult,
} from '../interfaces';

@Injectable()
export class OpenAiProvider implements ILlmProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  readonly name = 'openai';
  private client?: OpenAI;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get isAvailable(): boolean {
    return !!this.config.openaiApiKey;
  }

  private async getClient(): Promise<OpenAI> {
    if (!this.client) {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({ apiKey: this.config.openaiApiKey });
    }
    return this.client;
  }

  async complete(options: LlmCompletionOptions): Promise<LlmCompletionResult> {
    const start = Date.now();
    const model = options.model ?? this.config.aiDefaultModel ?? 'gpt-4o-mini';

    try {
      const client = await this.getClient();

      const response = await client.chat.completions.create({
        model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
      });

      const choice = response.choices?.[0];

      return {
        content: choice?.message?.content ?? '',
        tokensIn: response.usage?.prompt_tokens ?? 0,
        tokensOut: response.usage?.completion_tokens ?? 0,
        model,
        provider: this.name,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      this.logger.error(
        `OpenAI complete() failed - Model: ${model}, Error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `OpenAI API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async completeStream(
    options: LlmCompletionOptions,
    onChunk: (chunk: LlmStreamChunk) => void,
  ): Promise<LlmCompletionResult> {
    const start = Date.now();
    const model = options.model ?? this.config.aiDefaultModel ?? 'gpt-4o-mini';

    try {
      const client = await this.getClient();

      const stream = await client.chat.completions.create({
        model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
        stream: true,
        stream_options: { include_usage: true },
      });

      let fullContent = '';
      let index = 0;
      let tokensIn = 0;
      let tokensOut = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content ?? '';
        const isFinished = chunk.choices?.[0]?.finish_reason !== null;

        if (delta) {
          fullContent += delta;
          onChunk({ content: delta, index: index++, isFinal: false });
        }

        if (chunk.usage) {
          tokensIn = chunk.usage.prompt_tokens ?? 0;
          tokensOut = chunk.usage.completion_tokens ?? 0;
        }

        if (isFinished && delta === '') {
          onChunk({ content: '', index: index++, isFinal: true });
        }
      }

      return {
        content: fullContent,
        tokensIn,
        tokensOut,
        model,
        provider: this.name,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      this.logger.error(
        `OpenAI completeStream() failed - Model: ${model}, Error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `OpenAI streaming API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async embed(text: string, model?: string): Promise<LlmEmbeddingResult> {
    const embeddingModel =
      model ?? this.config.aiEmbeddingModel ?? 'text-embedding-3-small';

    try {
      const client = await this.getClient();

      const response = await client.embeddings.create({
        model: embeddingModel,
        input: text,
      });

      return {
        embedding: response.data[0].embedding,
        tokensUsed: response.usage?.total_tokens ?? 0,
        model: embeddingModel,
        provider: this.name,
      };
    } catch (error) {
      this.logger.error(
        `OpenAI embed() failed - Model: ${embeddingModel}, Text length: ${text.length}, Error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `OpenAI embedding API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async embedBatch(
    texts: string[],
    model?: string,
  ): Promise<LlmEmbeddingResult[]> {
    if (texts.length === 0) return [];

    const embeddingModel =
      model ?? this.config.aiEmbeddingModel ?? 'text-embedding-3-small';

    try {
      const client = await this.getClient();

      const response = await client.embeddings.create({
        model: embeddingModel,
        input: texts,
      });

      // response.data is ordered to match the input array
      const totalTokens = response.usage?.total_tokens ?? 0;
      const count = response.data.length;
      const base = count > 0 ? Math.floor(totalTokens / count) : 0;
      const remainder = count > 0 ? totalTokens % count : 0;
      const last = count - 1;

      return response.data.map((item, i) => ({
        embedding: item.embedding,
        tokensUsed: i === last ? base + remainder : base,
        model: embeddingModel,
        provider: this.name,
      }));
    } catch (error) {
      this.logger.error(
        `OpenAI embedBatch() failed - Model: ${embeddingModel}, Count: ${texts.length}, Error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `OpenAI batch embedding API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
