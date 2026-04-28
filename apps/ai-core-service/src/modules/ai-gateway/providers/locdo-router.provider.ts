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
export class LocDoRouterProvider implements ILlmProvider {
  private readonly logger = new Logger(LocDoRouterProvider.name);
  readonly name = 'locdo_router';
  private client?: OpenAI;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get isAvailable(): boolean {
    if (!this.config.lcdoRouterUrl || !this.config.lcdoRouterKey) return false;
    try {
      const { protocol } = new URL(this.config.lcdoRouterUrl);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }

  private async getClient(): Promise<OpenAI> {
    if (!this.client) {
      const { default: OpenAI } = await import('openai');
      const routerRoot = this.config.lcdoRouterUrl!.replace(/\/$/, '');
      this.client = new OpenAI({
        apiKey: this.config.lcdoRouterKey,
        baseURL: `${routerRoot}/v2`,
      });
    }
    return this.client;
  }

  private get defaultModel(): string {
    return this.config.lcdoRouterModel ?? 'claude-sonnet-4-6';
  }

  async complete(options: LlmCompletionOptions): Promise<LlmCompletionResult> {
    const start = Date.now();
    const model = options.model ?? this.defaultModel;

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
        `LocDoRouter complete() failed - Model: ${model}, Error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `LocDo Router API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async completeStream(
    options: LlmCompletionOptions,
    onChunk: (chunk: LlmStreamChunk) => void,
  ): Promise<LlmCompletionResult> {
    const start = Date.now();
    const model = options.model ?? this.defaultModel;

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
        `LocDoRouter completeStream() failed - Model: ${model}, Error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `LocDo Router streaming API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  embed(): Promise<LlmEmbeddingResult> {
    return Promise.reject(
      new Error(
        'LocDo Router does not support embeddings. Use OpenAiProvider for embeddings.',
      ),
    );
  }

  embedBatch(): Promise<LlmEmbeddingResult[]> {
    return Promise.reject(
      new Error(
        'LocDo Router does not support batch embeddings. Use OpenAiProvider for embeddings.',
      ),
    );
  }
}
