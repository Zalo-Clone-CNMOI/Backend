import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MessageRepository } from '@libs/scylla';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { BusinessException } from '@app/types';
import type { AiZaiChatRequestEvent } from '@libs/contracts';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import type {
  LlmChatMessage,
  LlmCompletionResult,
} from '../ai-gateway/interfaces';
import type { AiChatSendInput } from '../../transport/ai-chat.publisher';
import { DocumentRagService } from './document-rag.service';

const HISTORY_LIMIT = 20;
const MENTION_HISTORY_LIMIT = 10;

/**
 * Shown to the user when the LLM returns empty/whitespace content
 * (refusal, provider glitch, truncation). Bilingual single line so we
 * don't need language detection in the engine.
 */
export const ZAI_EMPTY_RESPONSE_FALLBACK =
  'Xin lỗi, tôi chưa thể trả lời câu này. Vui lòng thử lại. / Sorry, I could not generate a response. Please try again.';

@Injectable()
export class ZaiChatEngine {
  private readonly logger = new Logger(ZaiChatEngine.name);

  constructor(
    private readonly messageRepo: MessageRepository,
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
    private readonly documentRag: DocumentRagService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async respond(
    event: AiZaiChatRequestEvent,
    onChunk?: (content: string) => Promise<void>,
  ): Promise<AiChatSendInput | null> {
    if (event.sender_id === this.config.zaiBotUserId) {
      return null;
    }

    const isMention = event.trigger === 'mention';
    const limit = isMention ? MENTION_HISTORY_LIMIT : HISTORY_LIMIT;

    let history: LlmChatMessage[] = [];
    try {
      const result = await this.messageRepo.getMessages(event.conversation_id, {
        limit,
      });
      history = result.items
        .filter((m) => !m.deleted_at && m.body?.trim())
        .reverse()
        .map((m) => ({
          role: m.sender_id === this.config.zaiBotUserId ? 'assistant' : 'user',
          content: m.body,
        }));
    } catch (fetchErr) {
      this.logger.warn(
        `[${event.trace_id}] History fetch failed for ${event.conversation_id}, using empty context`,
        fetchErr,
      );
    }

    const feature = event.ai_context?.feature;
    const documentId = event.ai_context?.document_id;

    let messages: LlmChatMessage[];

    if (feature === 'document' && documentId) {
      try {
        await this.documentRag.validateDocumentAccess(
          event.sender_id,
          documentId,
        );
        messages = await this.documentRag.buildRagMessages(
          event.sender_id,
          documentId,
          event.body,
          history,
        );
      } catch (err) {
        if (err instanceof BusinessException) {
          return {
            message_id: randomUUID(),
            conversation_id: event.conversation_id,
            body: 'This document is no longer available.',
            trace_id: event.trace_id ?? `zai-${randomUUID()}`,
          };
        }
        throw err;
      }
    } else if (isMention) {
      messages = this.promptBuilder.buildZaiMentionReplyPrompt(
        history,
        event.body,
      );
    } else {
      messages = this.promptBuilder.buildZaiChatPrompt(history);
    }

    const startMs = Date.now();

    try {
      let result: LlmCompletionResult;

      if (onChunk) {
        result = await this.gateway.completeStream(
          event.sender_id,
          { messages, maxTokens: 1024, temperature: 0.7 },
          (chunk) => {
            if (chunk.content) {
              // gateway expects sync onChunk; the consumer's callback is async
              // (it publishes to Kafka). Detach the promise but catch rejections
              // so a failed chunk publish does NOT become an unhandled rejection.
              void onChunk(chunk.content).catch((err) => {
                this.logger.warn(
                  `[${event.trace_id}] Stream chunk callback failed: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
            }
          },
        );
      } else {
        result = await this.gateway.complete(event.sender_id, {
          messages,
          maxTokens: 1024,
          temperature: 0.7,
        });
      }

      // The LLM responded — record the call as a success regardless of
      // whether the content was usable. Empty/whitespace content gets
      // swapped for a fallback below so we never persist a blank bubble.
      this.aiMetrics.recordRequest(
        'zai_chat',
        result.provider,
        result.model,
        result.tokensIn,
        result.tokensOut,
        result.latencyMs,
        true,
      );

      const trimmed = result.content?.trim();
      const body = trimmed ? result.content : ZAI_EMPTY_RESPONSE_FALLBACK;
      if (!trimmed) {
        this.logger.warn(
          `[${event.trace_id}] Empty LLM response for ${event.conversation_id} (provider: ${result.provider}); using fallback`,
        );
      }

      return {
        message_id: randomUUID(),
        conversation_id: event.conversation_id,
        body,
        trace_id: event.trace_id ?? `zai-${randomUUID()}`,
      };
    } catch (err) {
      this.aiMetrics.recordRequest(
        'zai_chat',
        'unknown',
        'unknown',
        0,
        0,
        Date.now() - startMs,
        false,
      );
      this.logger.error(
        `[${event.trace_id}] Zai gateway failed for ${event.conversation_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
