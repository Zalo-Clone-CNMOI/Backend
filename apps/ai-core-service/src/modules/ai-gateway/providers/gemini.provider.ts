import { Injectable, Logger, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
import type { GoogleGenerativeAI } from '@google/generative-ai';
import {
  ILlmProvider,
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmStreamChunk,
  LlmEmbeddingResult,
} from '../interfaces';
import { flattenMessages } from './content.util';

@Injectable()
export class GeminiProvider implements ILlmProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  readonly name = 'gemini';
  private client?: GoogleGenerativeAI;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get isAvailable(): boolean {
    return !!this.config.geminiApiKey;
  }

  private async getClient(): Promise<GoogleGenerativeAI> {
    if (!this.client) {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      this.client = new GoogleGenerativeAI(this.config.geminiApiKey!);
    }
    return this.client;
  }

  async complete(options: LlmCompletionOptions): Promise<LlmCompletionResult> {
    const start = Date.now();
    const model = options.model ?? 'gemini-1.5-flash';

    try {
      const client = await this.getClient();
      const genModel = client.getGenerativeModel({ model });

      // Text-only provider: flatten any image parts (LocDo is the vision path).
      const flatMessages = flattenMessages(options.messages);
      const systemMsg = flatMessages.find((m) => m.role === 'system');
      const chatMessages = flatMessages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content as string }],
        }));

      const chat = genModel.startChat({
        history: chatMessages.slice(0, -1),
        systemInstruction: systemMsg?.content as string,
        generationConfig: {
          maxOutputTokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.7,
        },
      });

      const lastMessage = chatMessages[chatMessages.length - 1];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const result = await chat.sendMessage(lastMessage.parts[0].text);
      const response = result.response;

      const tokensIn = response.usageMetadata?.promptTokenCount ?? 0;
      const tokensOut = response.usageMetadata?.candidatesTokenCount ?? 0;

      return {
        content: response.text() ?? '',
        tokensIn,
        tokensOut,
        model,
        provider: this.name,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      this.logger.error(
        `Gemini complete() failed - Model: ${model}, Error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `Gemini API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async completeStream(
    options: LlmCompletionOptions,
    onChunk: (chunk: LlmStreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<LlmCompletionResult> {
    const start = Date.now();
    const model = options.model ?? 'gemini-1.5-flash';

    // Hoisted so the abort path can return the partial collected so far.
    let fullContent = '';
    let index = 0;

    try {
      const client = await this.getClient();
      const genModel = client.getGenerativeModel({ model });

      // Text-only provider: flatten any image parts (LocDo is the vision path).
      const flatMessages = flattenMessages(options.messages);
      const systemMsg = flatMessages.find((m) => m.role === 'system');
      const chatMessages = flatMessages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content as string }],
        }));

      const chat = genModel.startChat({
        history: chatMessages.slice(0, -1),
        systemInstruction: systemMsg?.content as string,
        generationConfig: {
          maxOutputTokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.7,
        },
      });

      const lastMessage = chatMessages[chatMessages.length - 1];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const result = await chat.sendMessageStream(lastMessage.parts[0].text);

      for await (const chunk of result.stream) {
        // Client gone — stop emitting and return the partial (Phase 6 C12).
        // NOTE: @google/generative-ai has no clean request-cancel hook, so the
        // underlying HTTP request may finish in the background; we simply stop
        // consuming and return. Tokens already spent are sunk.
        if (signal?.aborted) break;

        const text = chunk.text?.() ?? '';
        if (text) {
          fullContent += text;
          onChunk({ content: text, index: index++, isFinal: false });
        }
      }

      if (signal?.aborted) {
        return {
          content: fullContent,
          tokensIn: 0,
          tokensOut: 0,
          model,
          provider: this.name,
          latencyMs: Date.now() - start,
        };
      }

      onChunk({ content: '', index: index++, isFinal: true });

      const response = await result.response;
      const tokensIn = response.usageMetadata?.promptTokenCount ?? 0;
      const tokensOut = response.usageMetadata?.candidatesTokenCount ?? 0;

      return {
        content: fullContent,
        tokensIn,
        tokensOut,
        model,
        provider: this.name,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      // Intentional abort — return the partial rather than failing over.
      if (signal?.aborted) {
        return {
          content: fullContent,
          tokensIn: 0,
          tokensOut: 0,
          model,
          provider: this.name,
          latencyMs: Date.now() - start,
        };
      }
      this.logger.error(
        `Gemini completeStream() failed - Model: ${model}, Error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `Gemini streaming API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  embed(): Promise<LlmEmbeddingResult> {
    throw new Error(
      'Gemini embedding not implemented. Use OpenAI provider for embeddings.',
    );
  }

  embedBatch(): Promise<LlmEmbeddingResult[]> {
    throw new Error(
      'Gemini batch embedding not implemented. Use OpenAI provider for embeddings.',
    );
  }
}
