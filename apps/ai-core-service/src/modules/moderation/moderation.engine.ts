/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { AiModerationLog } from '@libs/database/entities';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { parseJsonResponse } from '../ai-gateway/services/parse-json.util';
import type {
  AiModerationRequestEvent,
  AiModerationResultEvent,
  ModerationLabelType,
  ModerationDecisionSourceType,
} from '@libs/contracts';
import { toAiProviderType } from '@libs/contracts';

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

  /** Providers polled when ensemble mode is enabled. */
  private static readonly ENSEMBLE_PROVIDERS = [
    'locdo_router',
    'openai',
    'gemini',
  ];

  /**
   * Moderate a chat message. Returns moderation result for Kafka emission.
   *
   * Two modes:
   *  - Single: one LLM call via fallback chain (default)
   *  - Ensemble: parallel calls to N providers, majority-vote on is_flagged
   *    (enabled via aiModerationEnsemble config; biased toward fail-closed
   *    on ties to maximize recall on harmful content)
   */
  async moderate(
    event: AiModerationRequestEvent,
  ): Promise<AiModerationResultEvent> {
    if (this.ensembleEnabled) {
      return this.ensembleModerate(event);
    }
    return this.singleModerate(event);
  }

  private async singleModerate(
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
        ensemble: false,
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
        ensemble: false,
        decision_source: parsed.decision_source,
        failure_reason: parsed.failure_reason,
        processed_at: Date.now(),
        tokens_used: result.tokensIn + result.tokensOut,
        trace_id: event.trace_id,
      };
    } catch (error) {
      return this.providerFailureFallback(event, error, false);
    }
  }

  private async ensembleModerate(
    event: AiModerationRequestEvent,
  ): Promise<AiModerationResultEvent> {
    const messages = this.promptBuilder.buildModerationPrompt(event.body);

    try {
      const results = await this.gateway.completeEnsemble(
        event.sender_id,
        { messages, maxTokens: 256, temperature: 0 },
        ModerationEngine.ENSEMBLE_PROVIDERS,
      );

      // No provider succeeded → fail-closed, mark as ensemble failure.
      if (results.length === 0) {
        return this.providerFailureFallback(event, null, true);
      }

      // Parse each result; track parses that themselves failed (returned fallback).
      const decisions = results.map((r) => ({
        provider: r.provider,
        parsed: this.parseResponse(r.content),
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        latencyMs: r.latencyMs,
        model: r.model,
      }));

      // Majority vote: ties bias toward `is_flagged=true` (fail-closed).
      // 2/3 flagged → flagged; 1/2 flagged → flagged (tie); 1/3 flagged → not flagged.
      const flaggedVotes = decisions.filter((d) => d.parsed.is_flagged).length;
      const isFlagged = flaggedVotes * 2 >= decisions.length;

      // Aggregate labels: union of labels from providers that voted with majority.
      // Confidence: average of providers that voted with majority.
      const majorityDecisions = decisions.filter(
        (d) => d.parsed.is_flagged === isFlagged,
      );
      const labelSet = new Set<ModerationLabelType>();
      for (const d of majorityDecisions) {
        for (const l of d.parsed.labels) labelSet.add(l);
      }
      const labels =
        labelSet.size > 0
          ? [...labelSet]
          : (['clean'] as ModerationLabelType[]);
      const confidence =
        majorityDecisions.reduce((sum, d) => sum + d.parsed.confidence, 0) /
        majorityDecisions.length;

      const totalTokensIn = decisions.reduce((s, d) => s + d.tokensIn, 0);
      const totalTokensOut = decisions.reduce((s, d) => s + d.tokensOut, 0);

      // Provider column is varchar(20). For ensemble rows we store the sentinel
      // "ensemble" (the `ensemble` boolean column already conveys participation;
      // per-provider details are in the ai_usage_logs metric stream).
      const log = this.moderationRepo.create({
        messageId: event.message_id,
        conversationId: event.conversation_id,
        senderId: event.sender_id,
        isFlagged,
        labels,
        confidence,
        provider: 'ensemble',
        ensemble: true,
        tokensUsed: totalTokensIn + totalTokensOut,
        traceId: event.trace_id ?? null,
      });
      await this.moderationRepo.save(log);

      // Record metrics once per provider that participated.
      for (const d of decisions) {
        this.aiMetrics.recordRequest(
          'moderation',
          d.provider,
          d.model,
          d.tokensIn,
          d.tokensOut,
          d.latencyMs,
          true,
        );
      }

      return {
        message_id: event.message_id,
        conversation_id: event.conversation_id,
        sender_id: event.sender_id,
        created_at: event.created_at,
        is_flagged: isFlagged,
        labels,
        confidence,
        provider: 'ensemble',
        ensemble: true,
        decision_source: 'model',
        processed_at: Date.now(),
        tokens_used: totalTokensIn + totalTokensOut,
        trace_id: event.trace_id,
      };
    } catch (error) {
      return this.providerFailureFallback(event, error, true);
    }
  }

  private async providerFailureFallback(
    event: AiModerationRequestEvent,
    error: unknown,
    ensemble: boolean,
  ): Promise<AiModerationResultEvent> {
    const message =
      error instanceof Error
        ? error.message
        : error == null
          ? 'no providers available'
          : typeof error === 'string'
            ? error
            : '[unknown error]';
    this.logger.error(
      `Moderation failed for message ${event.message_id} (ensemble=${ensemble}): ${message}`,
    );

    const fallback = this.fallbackModeration('fallback_provider_failure');

    try {
      const log = this.moderationRepo.create({
        messageId: event.message_id,
        conversationId: event.conversation_id,
        senderId: event.sender_id,
        isFlagged: fallback.is_flagged,
        labels: fallback.labels,
        confidence: fallback.confidence,
        provider: ensemble ? 'ensemble' : 'unknown',
        ensemble,
        tokensUsed: 0,
        traceId: event.trace_id ?? null,
      });
      await this.moderationRepo.save(log);
    } catch (logError) {
      this.logger.error(
        `Failed to persist moderation fallback log for ${event.message_id}: ${logError instanceof Error ? logError.message : String(logError)}`,
      );
    }

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
      ...fallback,
      provider: ensemble ? 'ensemble' : 'openai',
      ensemble,
      decision_source: 'fallback_provider_failure',
      failure_reason: message,
      processed_at: Date.now(),
      tokens_used: 0,
      trace_id: event.trace_id,
    };
  }

  private parseResponse(content: string): {
    is_flagged: boolean;
    labels: ModerationLabelType[];
    confidence: number;
    decision_source: ModerationDecisionSourceType;
    failure_reason?: string;
  } {
    try {
      const json = parseJsonResponse(content);
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
