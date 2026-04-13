/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { AiModerationLog } from '@libs/database/entities';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import type {
  AiModerationRequestEvent,
  AiModerationResultEvent,
  ModerationLabelType,
  AiProviderType,
  ModerationDecisionSourceType,
} from '@libs/contracts';

const toAiProviderType = (provider: string): AiProviderType => {
  if (
    provider === 'openai' ||
    provider === 'gemini' ||
    provider === 'anthropic'
  ) {
    return provider;
  }
  return 'openai';
};

@Injectable()
export class ModerationEngine {
  private readonly logger = new Logger(ModerationEngine.name);
  private readonly ensembleEnabled: boolean;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
    @InjectRepository(AiModerationLog)
    private readonly moderationRepo: Repository<AiModerationLog>,
  ) {
    this.ensembleEnabled = config.aiModerationEnsemble === true;
    if (config.aiModerationFailOpen === true) {
      this.logger.warn(
        'aiModerationFailOpen=true is ignored; moderation fallback is enforced fail-closed',
      );
    }
    this.logger.log(
      `Moderation engine initialized (ensemble: ${this.ensembleEnabled}, failClosed: true)`,
    );
  }

  /**
   * Moderate a chat message. Returns moderation result for Kafka emission.
   */
  async moderate(
    event: AiModerationRequestEvent,
  ): Promise<AiModerationResultEvent> {
    const messages = this.promptBuilder.buildModerationPrompt(event.body);

    try {
      const result = await this.gateway.complete(event.sender_id, {
        messages,
        maxTokens: 256,
        temperature: 0,
      });

      const parsed = this.parseResponse(result.content);

      const log = this.moderationRepo.create({
        messageId: event.message_id,
        conversationId: event.conversation_id,
        senderId: event.sender_id,
        isFlagged: parsed.is_flagged,
        labels: parsed.labels,
        confidence: parsed.confidence,
        provider: result.provider,
        ensemble: this.ensembleEnabled,
        tokensUsed: result.tokensIn + result.tokensOut,
        traceId: event.trace_id ?? null,
      });
      await this.moderationRepo.save(log);

      this.aiMetrics.recordRequest(
        'moderation',
        result.provider,
        result.model,
        result.tokensIn,
        result.tokensOut,
        result.latencyMs,
        true,
      );

      return {
        message_id: event.message_id,
        conversation_id: event.conversation_id,
        sender_id: event.sender_id,
        created_at: event.created_at,
        is_flagged: parsed.is_flagged,
        labels: parsed.labels,
        confidence: parsed.confidence,
        provider: toAiProviderType(result.provider),
        ensemble: this.ensembleEnabled,
        decision_source: parsed.decision_source,
        failure_reason: parsed.failure_reason,
        processed_at: Date.now(),
        tokens_used: result.tokensIn + result.tokensOut,
        trace_id: event.trace_id,
      };
    } catch (error) {
      this.logger.error(
        `Moderation failed for message ${event.message_id}: ${error instanceof Error ? error.message : String(error)}`,
      );

      this.aiMetrics.recordRequest(
        'moderation',
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
        sender_id: event.sender_id,
        created_at: event.created_at,
        ...this.fallbackModeration('fallback_provider_failure'),
        provider: 'openai' as const,
        ensemble: false,
        decision_source: 'fallback_provider_failure',
        failure_reason:
          error instanceof Error ? error.message : 'provider_request_failed',
        processed_at: Date.now(),
        tokens_used: 0,
        trace_id: event.trace_id,
      };
    }
  }

  private parseResponse(content: string): {
    is_flagged: boolean;
    labels: ModerationLabelType[];
    confidence: number;
    decision_source: ModerationDecisionSourceType;
    failure_reason?: string;
  } {
    try {
      const json = JSON.parse(content);
      return {
        is_flagged: !!json.is_flagged,
        labels: Array.isArray(json.labels)
          ? (json.labels as ModerationLabelType[])
          : ['clean' as ModerationLabelType],
        confidence: typeof json.confidence === 'number' ? json.confidence : 0,
        decision_source: 'model',
      };
    } catch {
      this.logger.warn(
        'Failed to parse moderation response, applying fallback moderation policy',
      );
      return this.fallbackModeration('fallback_parse_failure');
    }
  }

  private fallbackModeration(
    source: Extract<
      ModerationDecisionSourceType,
      'fallback_provider_failure' | 'fallback_parse_failure'
    >,
  ): {
    is_flagged: boolean;
    labels: ModerationLabelType[];
    confidence: number;
    decision_source: ModerationDecisionSourceType;
    failure_reason: string;
  } {
    return {
      is_flagged: true,
      labels: ['spam' as ModerationLabelType],
      confidence: 1,
      decision_source: source,
      failure_reason:
        source === 'fallback_parse_failure'
          ? 'moderation_response_parse_failed'
          : 'moderation_provider_failed',
    };
  }
}
