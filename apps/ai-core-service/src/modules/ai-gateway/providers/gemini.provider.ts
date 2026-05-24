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

      const systemMsg = options.messages.find((m) => m.role === 'system');
      const chatMessages = options.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          // TODO(Phase-3): when m.content is LlmContentPart[], this produces a malformed
          // Gemini part ({ text: <array> }). Map to multiple parts with image data before
          // shipping any engine that emits image_url content.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parts: [{ text: m.content as any }],
        }));

      const chat = genModel.startChat({
        history: chatMessages.slice(0, -1),
        // TODO(Phase-3): multimodal content parts are passed through as-is; provider
        // SDK error path is currently the only signal if an array reaches the API.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        systemInstruction: systemMsg?.content as any,
        generationConfig: {
          maxOutputTokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.7,
        },
      });

      const lastMessage = chatMessages[chatMessages.length - 1];
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
  ): Promise<LlmCompletionResult> {
    const start = Date.now();
    const model = options.model ?? 'gemini-1.5-flash';

    try {
      const client = await this.getClient();
      const genModel = client.getGenerativeModel({ model });

      const systemMsg = options.messages.find((m) => m.role === 'system');
      const chatMessages = options.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          // TODO(Phase-3): when m.content is LlmContentPart[], this produces a malformed
          // Gemini part ({ text: <array> }). Map to multiple parts with image data before
          // shipping any engine that emits image_url content.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parts: [{ text: m.content as any }],
        }));

      const chat = genModel.startChat({
        history: chatMessages.slice(0, -1),
        // TODO(Phase-3): multimodal content parts are passed through as-is; provider
        // SDK error path is currently the only signal if an array reaches the API.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        systemInstruction: systemMsg?.content as any,
        generationConfig: {
          maxOutputTokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.7,
        },
      });

      const lastMessage = chatMessages[chatMessages.length - 1];
      const result = await chat.sendMessageStream(lastMessage.parts[0].text);

      let fullContent = '';
      let index = 0;

      for await (const chunk of result.stream) {
        const text = chunk.text?.() ?? '';
        if (text) {
          fullContent += text;
          onChunk({ content: text, index: index++, isFinal: false });
        }
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
