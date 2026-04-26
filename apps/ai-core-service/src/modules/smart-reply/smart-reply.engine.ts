/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Injectable, Logger } from '@nestjs/common';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import type {
  AiSmartReplyRequestEvent,
  AiSmartReplyResultEvent,
} from '@libs/contracts';
import { toAiProviderType } from '@libs/contracts';

@Injectable()
export class SmartReplyEngine {
  private readonly logger = new Logger(SmartReplyEngine.name);

  constructor(
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
  ) {}

  /**
   * Generate smart reply suggestions for a conversation.
   */
  async generateReplies(
    event: AiSmartReplyRequestEvent,
    conversationContext: string[] = [],
  ): Promise<AiSmartReplyResultEvent> {
    try {
      const messages = this.promptBuilder.buildSmartReplyPrompt(
        event.last_message_body,
        conversationContext,
      );

      const result = await this.gateway.complete(event.user_id, {
        messages,
        maxTokens: 256,
        temperature: 0.8,
      });

      const parsed = this.parseResponse(result.content);

      this.aiMetrics.recordRequest(
        'smart_reply',
        result.provider,
        result.model,
        result.tokensIn,
        result.tokensOut,
        result.latencyMs,
        true,
      );

      return {
        conversation_id: event.conversation_id,
        user_id: event.user_id,
        suggestions: parsed.suggestions,
        provider: toAiProviderType(result.provider),
        tokens_used: result.tokensIn + result.tokensOut,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    } catch (error) {
      this.logger.error(
        `Smart reply failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      this.aiMetrics.recordRequest(
        'smart_reply',
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
        suggestions: [],
        provider: 'openai',
        tokens_used: 0,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    }
  }

  private parseResponse(content: string): { suggestions: string[] } {
    try {
      const json = JSON.parse(content);
      return {
        suggestions: Array.isArray(json.suggestions)
          ? json.suggestions.slice(0, 3)
          : [],
      };
    } catch {
      this.logger.warn('Failed to parse smart reply response');
      return { suggestions: [] };
    }
  }
}

