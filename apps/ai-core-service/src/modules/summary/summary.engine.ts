/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { RedisService } from '@libs/redis';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { parseJsonResponse } from '../ai-gateway/services/parse-json.util';
import type {
  AiSummaryRequestEvent,
  AiSummaryResultEvent,
} from '@libs/contracts';
import { toAiProviderType } from '@libs/contracts';

/**
 * SummaryEngine — generates conversation summaries with caching.
 *
 * Cache key: ai:summary:{conversationId}
 * Cache TTL: 1 hour (conversation-level summary cache)
 */
@Injectable()
export class SummaryEngine {
  private readonly logger = new Logger(SummaryEngine.name);
  private readonly cacheEnabled: boolean;
  private readonly CACHE_TTL = 3600; // 1 hour

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
    private readonly redis: RedisService,
  ) {
    this.cacheEnabled = config.aiEnableConversationCache !== false;
  }

  /**
   * Generate or retrieve cached summary for a conversation.
   */
  async summarize(
    event: AiSummaryRequestEvent,
    messages: string[],
  ): Promise<AiSummaryResultEvent> {
    const cacheKey = `ai:summary:${event.conversation_id}`;

    if (this.cacheEnabled) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for summary: ${event.conversation_id}`);
        try {
          const parsed = JSON.parse(cached);
          return {
            ...parsed,
            user_id: event.user_id,
            cached: true,
            processed_at: Date.now(),
            trace_id: event.trace_id,
          };
        } catch {
          this.logger.warn(
            `Invalid cached summary payload: ${event.conversation_id}`,
          );
        }
      }
    }

    try {
      const prompts = this.promptBuilder.buildSummaryPrompt(messages);

      const result = await this.gateway.complete(event.user_id, {
        messages: prompts,
        maxTokens: 512,
        temperature: 0.3,
      });

      const parsed = this.parseResponse(result.content);

      this.aiMetrics.recordRequest(
        'summary',
        result.provider,
        result.model,
        result.tokensIn,
        result.tokensOut,
        result.latencyMs,
        true,
      );

      const summaryResult: AiSummaryResultEvent = {
        conversation_id: event.conversation_id,
        user_id: event.user_id,
        summary: parsed.summary,
        message_range: {
          from_message_id: event.message_ids?.[0] ?? 'unknown',
          to_message_id:
            event.message_ids?.[event.message_ids.length - 1] ?? 'unknown',
          count: messages.length,
        },
        provider: toAiProviderType(result.provider),
        tokens_used: result.tokensIn + result.tokensOut,
        cached: false,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };

      if (this.cacheEnabled) {
        await this.redis.setEx(
          cacheKey,
          this.CACHE_TTL,
          JSON.stringify({
            conversation_id: summaryResult.conversation_id,
            summary: summaryResult.summary,
            message_range: summaryResult.message_range,
            provider: summaryResult.provider,
            tokens_used: summaryResult.tokens_used,
          }),
        );
      }

      return summaryResult;
    } catch (error) {
      this.logger.error(
        `Summary failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      this.aiMetrics.recordRequest(
        'summary',
        'unknown',
        'unknown',
        0,
        0,
        0,
        false,
      );

      return {
        conversation_id: event.conversation_id,
        user_id: event.user_id,
        summary: 'Summary generation failed. Please try again later.',
        message_range: { from_message_id: '', to_message_id: '', count: 0 },
        provider: 'openai',
        tokens_used: 0,
        cached: false,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    }
  }

  private parseResponse(content: string): { summary: string } {
    try {
      const json = parseJsonResponse(content);
      return {
        summary: typeof json.summary === 'string' ? json.summary : content,
      };
    } catch {
      return { summary: content };
    }
  }
}
