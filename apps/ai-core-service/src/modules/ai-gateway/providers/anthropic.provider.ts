import { Injectable, Logger, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
import type Anthropic from '@anthropic-ai/sdk';
import {
  ILlmProvider,
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmStreamChunk,
  LlmEmbeddingResult,
} from '../interfaces';

@Injectable()
export class AnthropicProvider implements ILlmProvider {
  private readonly logger = new Logger(AnthropicProvider.name);
  readonly name = 'anthropic';
  private client?: Anthropic;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get isAvailable(): boolean {
    return !!this.config.anthropicApiKey;
  }

  private async getClient(): Promise<Anthropic> {
    if (!this.client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.client = new Anthropic({ apiKey: this.config.anthropicApiKey });
    }
    return this.client;
  }

  async complete(options: LlmCompletionOptions): Promise<LlmCompletionResult> {
    const start = Date.now();
    const model = options.model ?? 'claude-3-haiku-20240307';

    try {
      const client = await this.getClient();

      const systemMsg = options.messages.find((m) => m.role === 'system');
      const chatMessages = options.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const response = await client.messages.create({
        model,
        max_tokens: options.maxTokens ?? 1024,
        // TODO(Phase-3): multimodal content parts are passed through as-is; provider
        // SDK error path is currently the only signal if an array reaches the API.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        system: systemMsg?.content as any,
        // TODO(Phase-3): multimodal content parts are passed through as-is; provider
        // SDK error path is currently the only signal if an array reaches the API.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        messages: chatMessages as any,
      });

      const content =
        response.content?.[0]?.type === 'text' ? response.content[0].text : '';

      return {
        content,
        tokensIn: response.usage?.input_tokens ?? 0,
        tokensOut: response.usage?.output_tokens ?? 0,
        model,
        provider: this.name,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      this.logger.error(
        `Anthropic complete() failed - Model: ${model}, Error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `Anthropic API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async completeStream(
    options: LlmCompletionOptions,
    onChunk: (chunk: LlmStreamChunk) => void,
  ): Promise<LlmCompletionResult> {
    const start = Date.now();
    const model = options.model ?? 'claude-3-haiku-20240307';

    try {
      const client = await this.getClient();

      const systemMsg = options.messages.find((m) => m.role === 'system');
      const chatMessages = options.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const stream = client.messages.stream({
        model,
        max_tokens: options.maxTokens ?? 1024,
        // TODO(Phase-3): multimodal content parts are passed through as-is; provider
        // SDK error path is currently the only signal if an array reaches the API.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        system: systemMsg?.content as any,
        // TODO(Phase-3): multimodal content parts are passed through as-is; provider
        // SDK error path is currently the only signal if an array reaches the API.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        messages: chatMessages as any,
      });

      let fullContent = '';
      let index = 0;

      stream.on('text', (text: string) => {
        fullContent += text;
        onChunk({ content: text, index: index++, isFinal: false });
      });

      const finalMessage = await stream.finalMessage();

      onChunk({ content: '', index: index++, isFinal: true });

      return {
        content: fullContent,
        tokensIn: finalMessage.usage?.input_tokens ?? 0,
        tokensOut: finalMessage.usage?.output_tokens ?? 0,
        model,
        provider: this.name,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      this.logger.error(
        `Anthropic completeStream() failed - Model: ${model}, Error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `Anthropic streaming API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  embed(): Promise<LlmEmbeddingResult> {
    throw new Error(
      'Anthropic does not support embeddings. Use OpenAI provider.',
    );
  }

  embedBatch(): Promise<LlmEmbeddingResult[]> {
    throw new Error(
      'Anthropic does not support batch embeddings. Use OpenAI provider.',
    );
  }
}
