import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MessageRepository } from '@libs/scylla';
import { APP_CONFIG, AppConfig } from '@libs/config';
import {
  type AiZaiChatRequestEvent,
  toAiProviderType,
} from '@libs/contracts';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import type {
  LlmChatMessage,
  LlmCompletionResult,
} from '../ai-gateway/interfaces';
import { DocumentRagService } from './document-rag.service';
import { ZaiMemoryService } from './zai-memory.service';
import {
  type ChatStrategy,
  DocumentChatStrategy,
  GeneralChatStrategy,
  MentionReplyStrategy,
  type ZaiChatResult,
} from './chat-strategy';

export type { ZaiChatResult } from './chat-strategy';

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

  /** Strategy registry resolved by (feature, trigger). New agents plug in here. */
  private readonly documentStrategy: ChatStrategy;
  private readonly mentionStrategy: ChatStrategy;
  private readonly generalStrategy: ChatStrategy;

  constructor(
    private readonly messageRepo: MessageRepository,
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
    private readonly documentRag: DocumentRagService,
    private readonly zaiMemory: ZaiMemoryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.documentStrategy = new DocumentChatStrategy(this.documentRag);
    this.mentionStrategy = new MentionReplyStrategy(this.promptBuilder);
    this.generalStrategy = new GeneralChatStrategy(this.promptBuilder);
  }

  /**
   * Resolve the chat strategy for this request. Document feature wins over
   * mention (a doc conversation that happens to @Zai stays document chat);
   * everything else falls back to general.
   */
  private resolveStrategy(event: AiZaiChatRequestEvent): ChatStrategy {
    const feature = event.ai_context?.feature;
    const documentId = event.ai_context?.document_id;

    if (feature === 'document' && documentId) {
      return this.documentStrategy;
    }
    if (event.trigger === 'mention') {
      return this.mentionStrategy;
    }
    return this.generalStrategy;
  }

  async respond(
    event: AiZaiChatRequestEvent,
    onChunk?: (content: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<ZaiChatResult | null> {
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

    // L2 rolling-summary memory (C8). No-op + zero I/O when the flag is OFF
    // (default), so this preserves the pure-L1 behaviour in production.
    history = await this.zaiMemory.withRollingSummary(
      event.conversation_id,
      event.sender_id,
      history,
      event.trace_id,
    );

    const strategy = this.resolveStrategy(event);
    const outcome = await strategy.buildMessages(event, history);
    if (outcome.kind === 'short-circuit') {
      // Pre-built reply that never reached the LLM (e.g. doc unavailable).
      return outcome.result;
    }
    const messages = outcome.messages;

    const startMs = Date.now();

    try {
      let result: LlmCompletionResult;

      if (onChunk) {
        result = await this.gateway.completeStream(
          event.sender_id,
          { messages, maxTokens: 1024, temperature: 0.7 },
          (chunk) => {
            if (signal?.aborted) return; // stop forwarding chunks on abort
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
          signal,
        );
      } else {
        result = await this.gateway.complete(event.sender_id, {
          messages,
          maxTokens: 1024,
          temperature: 0.7,
        });
      }

      // Stream aborted (client disconnected) — discard the partial reply: no
      // metrics, no persisted message, no AiStreamComplete (Phase 6 C12).
      if (signal?.aborted) {
        this.logger.log(
          `[${event.trace_id}] Zai stream aborted for ${event.conversation_id}; discarding partial reply`,
        );
        return null;
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
        reply: {
          message_id: randomUUID(),
          conversation_id: event.conversation_id,
          body,
          trace_id: event.trace_id ?? `zai-${randomUUID()}`,
          // C7: document-chat replies are markdown; others stay text default.
          ...(strategy.bodyFormat
            ? { body_format: strategy.bodyFormat }
            : {}),
        },
        provider: toAiProviderType(result.provider),
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
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
