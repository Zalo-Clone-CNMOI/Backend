/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@libs/redis';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import type {
  AiTranslateRequestEvent,
  AiTranslateResultEvent,
} from '@libs/contracts';
import { toAiProviderType } from '@libs/contracts';

/**
 * TranslationEngine — translates messages with 24h Redis cache.
 *
 * Cache key: ai:translate:{md5(body)}:{targetLanguage}
 * Cache TTL: 24 hours
 */
@Injectable()
export class TranslationEngine {
  private readonly logger = new Logger(TranslationEngine.name);
  private readonly CACHE_TTL = 86400; // 24 hours

  constructor(
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Translate a message, checking cache first.
   */
  async translate(
    event: AiTranslateRequestEvent,
  ): Promise<AiTranslateResultEvent> {
    const cacheKey = this.getCacheKey(event.body, event.target_language);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug('Translation cache hit');
      try {
        const parsed = JSON.parse(cached);
        return {
          message_id: event.message_id,
          conversation_id: event.conversation_id,
          user_id: event.user_id,
          original_body: event.body,
          translated_body: parsed.translated_text,
          source_language: parsed.source_language,
          target_language: event.target_language,
          provider: parsed.provider,
          tokens_used: 0,
          cached: true,
          processed_at: Date.now(),
          trace_id: event.trace_id,
        };
      } catch {
        this.logger.warn(
          `Invalid translation cache payload for message ${event.message_id}`,
        );
      }
    }

    try {
      const messages = this.promptBuilder.buildTranslationPrompt(
        event.body,
        event.source_language,
        event.target_language,
      );

      const result = await this.gateway.complete(event.user_id, {
        messages,
        maxTokens: 1024,
        temperature: 0.3,
      });

      const parsed = this.parseResponse(result.content);

      this.aiMetrics.recordRequest(
        'translation',
        result.provider,
        result.model,
        result.tokensIn,
        result.tokensOut,
        result.latencyMs,
        true,
      );

      await this.redis.setEx(
        cacheKey,
        this.CACHE_TTL,
        JSON.stringify({
          translated_text: parsed.translated_text,
          source_language: parsed.source_language,
          provider: result.provider,
        }),
      );

      return {
        message_id: event.message_id,
        conversation_id: event.conversation_id,
        user_id: event.user_id,
        original_body: event.body,
        translated_body: parsed.translated_text,
        source_language:
          parsed.source_language ?? event.source_language ?? 'auto',
        target_language: event.target_language,
        provider: toAiProviderType(result.provider),
        tokens_used: result.tokensIn + result.tokensOut,
        cached: false,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    } catch (error) {
      this.logger.error(
        `Translation failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      this.aiMetrics.recordRequest(
        'translation',
        'unknown',
        'unknown',
        0,
        0,
        0,
        false,
      );

      return {
        message_id: event.message_id,
        conversation_id: event.conversation_id,
        user_id: event.user_id,
        original_body: event.body,
        translated_body: event.body,
        source_language: event.source_language ?? 'unknown',
        target_language: event.target_language,
        provider: 'openai',
        tokens_used: 0,
        cached: false,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    }
  }

  private getCacheKey(body: string, targetLang: string): string {
    const hash = Buffer.from(body).toString('base64url').slice(0, 32);
    return `ai:translate:${hash}:${targetLang}`;
  }

  private parseResponse(content: string): {
    translated_text: string;
    source_language: string;
  } {
    try {
      const json = JSON.parse(content);
      return {
        translated_text: json.translated_text ?? content,
        source_language: json.source_language ?? 'auto',
      };
    } catch {
      return { translated_text: content, source_language: 'auto' };
    }
  }
}
