import { randomUUID } from 'crypto';
import { BusinessException } from '@app/types';
import type {
  AiProviderType,
  AiZaiChatRequestEvent,
  MessageBodyFormat,
} from '@libs/contracts';
import type { LlmChatMessage } from '../ai-gateway/interfaces';
import type { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import type { DocumentRagService } from './document-rag.service';
import type { AiChatSendInput } from '../../transport/ai-chat.publisher';

/**
 * Engine result: the message to publish PLUS the provider/token telemetry
 * the consumer needs to populate AiStreamComplete accurately (Phase 6 S1).
 * provider='unknown' + zero tokens for fallbacks that never reached the LLM
 * (e.g. document-no-longer-available).
 */
export interface ZaiChatResult {
  reply: AiChatSendInput;
  provider: AiProviderType;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Outcome of a strategy's message build. Either the LLM messages to run, or a
 * short-circuit reply that never reaches the LLM (e.g. document unavailable).
 */
export type StrategyOutcome =
  | { kind: 'messages'; messages: LlmChatMessage[] }
  | { kind: 'short-circuit'; result: ZaiChatResult };

/**
 * A pluggable Zai chat behaviour. The engine resolves one strategy per request
 * by (feature, trigger), then runs the shared gateway + stream + metrics tail.
 * New agents add a strategy + a resolver branch without touching the tail.
 */
export interface ChatStrategy {
  /** Stable identifier for logs/metrics. */
  readonly name: string;
  /**
   * body_format applied to the LLM reply for this strategy. Omit for the
   * default 'text'. Document chat replies are markdown (C7).
   */
  readonly bodyFormat?: MessageBodyFormat;
  buildMessages(
    event: AiZaiChatRequestEvent,
    history: LlmChatMessage[],
  ): Promise<StrategyOutcome>;
}

/**
 * Document RAG chat. Validates access, builds RAG messages with history, and
 * gracefully short-circuits to a plain-text notice when the document is gone.
 * Replies are markdown (the doc-chat prompt permits short markdown lists).
 */
export class DocumentChatStrategy implements ChatStrategy {
  readonly name = 'document';
  readonly bodyFormat: MessageBodyFormat = 'markdown';

  constructor(private readonly documentRag: DocumentRagService) {}

  async buildMessages(
    event: AiZaiChatRequestEvent,
    history: LlmChatMessage[],
  ): Promise<StrategyOutcome> {
    const documentId = event.ai_context?.document_id;
    if (!documentId) {
      return this.unavailable(event);
    }

    try {
      await this.documentRag.validateDocumentAccess(
        event.sender_id,
        documentId,
      );
      const messages = await this.documentRag.buildRagMessages(
        event.sender_id,
        documentId,
        event.body,
        history,
      );
      return { kind: 'messages', messages };
    } catch (err) {
      if (err instanceof BusinessException) {
        return this.unavailable(event);
      }
      throw err;
    }
  }

  private unavailable(event: AiZaiChatRequestEvent): StrategyOutcome {
    return {
      kind: 'short-circuit',
      result: {
        // Plain text: this is a system notice, not a markdown doc reply.
        reply: {
          message_id: randomUUID(),
          conversation_id: event.conversation_id,
          body: 'This document is no longer available.',
          trace_id: event.trace_id ?? `zai-${randomUUID()}`,
        },
        provider: 'unknown',
        tokensIn: 0,
        tokensOut: 0,
      },
    };
  }
}

/**
 * @Zai mention reply in a group/DM. Smaller history window; conversational
 * prompt that answers the mentioning message directly.
 */
export class MentionReplyStrategy implements ChatStrategy {
  readonly name = 'mention';

  constructor(private readonly promptBuilder: PromptBuilderService) {}

  buildMessages(
    event: AiZaiChatRequestEvent,
    history: LlmChatMessage[],
  ): Promise<StrategyOutcome> {
    return Promise.resolve({
      kind: 'messages',
      messages: this.promptBuilder.buildZaiMentionReplyPrompt(
        history,
        event.body,
      ),
    });
  }
}

/**
 * Default Zai conversation (1:1 AI chat / fallback). Full history window.
 */
export class GeneralChatStrategy implements ChatStrategy {
  readonly name = 'general';

  constructor(private readonly promptBuilder: PromptBuilderService) {}

  buildMessages(
    _event: AiZaiChatRequestEvent,
    history: LlmChatMessage[],
  ): Promise<StrategyOutcome> {
    return Promise.resolve({
      kind: 'messages',
      messages: this.promptBuilder.buildZaiChatPrompt(history),
    });
  }
}
