/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
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
  private client: any;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get isAvailable(): boolean {
    return !!this.config.geminiApiKey;
  }

  private async getClient() {
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

      // Convert messages to Gemini format
      const systemMsg = options.messages.find((m) => m.role === 'system');
      const chatMessages = options.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const chat = genModel.startChat({
        history: chatMessages.slice(0, -1),
        systemInstruction: systemMsg
          ? { parts: [{ text: systemMsg.content }] }
          : undefined,
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
          parts: [{ text: m.content }],
        }));

      const chat = genModel.startChat({
        history: chatMessages.slice(0, -1),
        systemInstruction: systemMsg
          ? { parts: [{ text: systemMsg.content }] }
          : undefined,
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

  async embed(_text: string, _model?: string): Promise<LlmEmbeddingResult> {
    throw new Error(
      'Gemini embedding not implemented. Use OpenAI provider for embeddings.',
    );
  }
}
