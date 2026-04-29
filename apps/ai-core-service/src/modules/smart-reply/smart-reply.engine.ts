import { Injectable, Logger } from '@nestjs/common';
import { MessageRepository } from '@libs/scylla';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import {
  parseJsonResponse,
  validateSuggestions,
} from '../ai-gateway/services/parse-json.util';
import type {
  AiSmartReplyContextMessage,
  AiSmartReplyRequestEvent,
  AiSmartReplyResultEvent,
} from '@libs/contracts';
import { toAiProviderType } from '@libs/contracts';

const CONTEXT_FETCH_LIMIT = 10;

@Injectable()
export class SmartReplyEngine {
  private readonly logger = new Logger(SmartReplyEngine.name);

  constructor(
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
    private readonly messageRepo: MessageRepository,
  ) {}

  async generateReplies(
    event: AiSmartReplyRequestEvent,
  ): Promise<AiSmartReplyResultEvent> {
    try {
      const contextMessages =
        event.context_messages.length > 0
          ? event.context_messages
          : await this.fetchContextMessages(
              event.conversation_id,
              event.user_id,
            );

      const messages = this.promptBuilder.buildSmartReplyPrompt(
        event.last_message_body,
        contextMessages,
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

  private async fetchContextMessages(
    conversationId: string,
    userId: string,
  ): Promise<AiSmartReplyContextMessage[]> {
    try {
      const { items } = await this.messageRepo.getMessages(conversationId, {
        limit: CONTEXT_FETCH_LIMIT,
      });

      return (
        items
          .filter((m) => !m.deleted_at && m.body)
          // ScyllaDB returns DESC (newest first); reverse to chronological for context
          .reverse()
          .map((m) => ({
            role: m.sender_id === userId ? ('me' as const) : ('them' as const),
            body: m.body,
          }))
      );
    } catch (err) {
      this.logger.warn(
        `ScyllaDB context fetch failed for ${conversationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private parseResponse(content: string): { suggestions: string[] } {
    try {
      const json = parseJsonResponse(content) as Record<string, unknown>;
      return { suggestions: validateSuggestions(json.suggestions) };
    } catch {
      this.logger.warn('Failed to parse smart reply response');
      return { suggestions: [] };
    }
  }
}
