import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MessageRepository } from '@libs/scylla';
import { APP_CONFIG, AppConfig } from '@libs/config';
import type { AiZaiChatRequestEvent } from '@libs/contracts';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import type { LlmChatMessage } from '../ai-gateway/interfaces';
import type { AiChatSendInput } from '../../transport/ai-chat.publisher';

const HISTORY_LIMIT = 20;

@Injectable()
export class ZaiChatEngine {
  private readonly logger = new Logger(ZaiChatEngine.name);

  constructor(
    private readonly messageRepo: MessageRepository,
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async respond(event: AiZaiChatRequestEvent): Promise<AiChatSendInput | null> {
    if (event.sender_id === this.config.zaiBotUserId) {
      return null;
    }

    let history: LlmChatMessage[] = [];
    try {
      const result = await this.messageRepo.getMessages(event.conversation_id, {
        limit: HISTORY_LIMIT,
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

    const messages = this.promptBuilder.buildZaiChatPrompt(history);
    const startMs = Date.now();

    try {
      const result = await this.gateway.complete(event.sender_id, {
        messages,
        maxTokens: 1024,
        temperature: 0.7,
      });

      this.aiMetrics.recordRequest(
        'zai_chat',
        result.provider,
        result.model,
        result.tokensIn,
        result.tokensOut,
        result.latencyMs,
        true,
      );

      return {
        message_id: randomUUID(),
        conversation_id: event.conversation_id,
        body: result.content,
        trace_id: event.trace_id ?? `zai-${Date.now()}`,
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
