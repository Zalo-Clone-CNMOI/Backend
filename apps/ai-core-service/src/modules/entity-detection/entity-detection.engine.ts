import { createHash } from 'crypto';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { AiEntityDetectionLog } from '@libs/database/entities';
import { RedisService } from '@libs/redis';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { parseJsonResponse } from '../ai-gateway/services/parse-json.util';
import {
  withTimeout,
  AI_SYNC_COMPLETION_TIMEOUT_MS,
} from '../ai-gateway/services/with-timeout.util';
import type {
  AiEntityDetectionRequestEvent,
  AiEntityDetectionResultEvent,
  AiEntityInfoRequestEvent,
  AiEntityInfoResultEvent,
  DetectedEntity,
  EntityType,
} from '@libs/contracts';
import { toAiProviderType } from '@libs/contracts';

const VALID_ENTITY_TYPES: readonly EntityType[] = [
  'tool',
  'company',
  'person',
  'concept',
  'location',
  'product',
  'other',
];
const MIN_CONFIDENCE = 0.75;

@Injectable()
export class EntityDetectionEngine {
  private readonly logger = new Logger(EntityDetectionEngine.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly gateway: AiGatewayService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly aiMetrics: AiMetricsService,
    private readonly redis: RedisService,
    @InjectRepository(AiEntityDetectionLog)
    private readonly logRepo: Repository<AiEntityDetectionLog>,
  ) {}

  /** Bounded deadline for a single detection LLM call (env-configurable). */
  private get detectionTimeoutMs(): number {
    return this.config.aiEntityDetectionTimeoutMs ?? 8000;
  }

  async detect(
    event: AiEntityDetectionRequestEvent,
  ): Promise<AiEntityDetectionResultEvent> {
    try {
      const messages = this.promptBuilder.buildEntityDetectionPrompt(
        event.body,
      );

      const result = await withTimeout(
        this.gateway.complete(event.sender_id, {
          model: this.config.aiEntityModel,
          messages,
          maxTokens: 512,
          temperature: 0,
          responseFormat: 'json_object',
        }),
        this.detectionTimeoutMs,
        'entity_detection',
      );

      let parsed = this.parseEntities(result.content, event.body);
      let totalTokensIn = result.tokensIn;
      let totalTokensOut = result.tokensOut;
      let totalLatencyMs = result.latencyMs;
      let parseFailedAfterRetry = false;

      if (parsed === null) {
        this.logger.warn(
          `Entity detection retry for message ${event.message_id} — initial parse failed for ${result.content.length}-char response`,
        );
        const retry = await withTimeout(
          this.gateway.complete(event.sender_id, {
            model: this.config.aiEntityModel,
            messages: [
              ...messages,
              { role: 'assistant', content: result.content },
              {
                role: 'user',
                content:
                  'Your previous response was not valid JSON. Return ONLY a valid JSON object with the "entities" array, no prose, no markdown fences.',
              },
            ],
            maxTokens: 512,
            temperature: 0,
            responseFormat: 'json_object',
          }),
          this.detectionTimeoutMs,
          'entity_detection_retry',
        );
        parsed = this.parseEntities(retry.content, event.body);
        totalTokensIn += retry.tokensIn;
        totalTokensOut += retry.tokensOut;
        totalLatencyMs += retry.latencyMs;
        if (parsed === null) {
          parseFailedAfterRetry = true;
          this.logger.error(
            `Entity detection retry also failed to parse for message ${event.message_id}`,
          );
        }
      }

      const entities = parsed ?? [];

      try {
        const log = this.logRepo.create({
          messageId: event.message_id,
          conversationId: event.conversation_id,
          senderId: event.sender_id,
          entities,
          provider: result.provider,
          tokensUsed: totalTokensIn + totalTokensOut,
          traceId: event.trace_id ?? null,
        });
        await this.logRepo.save(log);
      } catch (dbError) {
        this.logger.warn(
          `Failed to persist entity detection log for ${event.message_id}: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
        );
      }

      this.aiMetrics.recordRequest(
        'entity_detection',
        result.provider,
        result.model,
        totalTokensIn,
        totalTokensOut,
        totalLatencyMs,
        !parseFailedAfterRetry,
      );

      return {
        message_id: event.message_id,
        conversation_id: event.conversation_id,
        entities,
        provider: toAiProviderType(result.provider),
        tokens_used: totalTokensIn + totalTokensOut,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    } catch (error) {
      this.logger.error(
        `Entity detection failed for message ${event.message_id}: ${error instanceof Error ? error.message : String(error)}`,
      );

      this.aiMetrics.recordRequest(
        'entity_detection',
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
        entities: [],
        provider: 'openai',
        tokens_used: 0,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    }
  }

  async generateInfo(
    event: AiEntityInfoRequestEvent,
  ): Promise<AiEntityInfoResultEvent> {
    const language = event.language ?? 'vi';
    const cacheKey = `ai:entity-info:${event.entity_type}:${createHash('sha256').update(event.entity_text).digest('hex').slice(0, 20)}:${language}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as AiEntityInfoResultEvent;
      } catch {
        this.logger.warn(
          `Corrupt entity info cache for "${event.entity_text}" — regenerating`,
        );
      }
    }

    try {
      const messages = this.promptBuilder.buildEntityInfoPrompt(
        event.entity_text,
        event.entity_type,
        language,
      );

      // Bound the call: the user is actively waiting on the info panel, so a
      // slow/hung provider must surface as a failure (→ graceful fallback below)
      // before the mobile client's own HTTP timeout fires.
      const result = await withTimeout(
        this.gateway.complete(event.user_id, {
          messages,
          maxTokens: 600,
          temperature: 0.1,
          responseFormat: 'json_object',
        }),
        AI_SYNC_COMPLETION_TIMEOUT_MS,
        'entity_info',
      );

      this.logger.debug(
        `[entity-info] raw LLM response for "${event.entity_text}" ` +
          `(provider=${result.provider} tokens=${result.tokensIn + result.tokensOut}): ` +
          result.content.slice(0, 500),
      );

      const parsed = this.parseInfoResponse(result.content, event.entity_text);

      this.aiMetrics.recordRequest(
        'entity_info',
        result.provider,
        result.model,
        result.tokensIn,
        result.tokensOut,
        result.latencyMs,
        true,
      );

      const infoResult: AiEntityInfoResultEvent = {
        entity_text: event.entity_text,
        entity_type: event.entity_type,
        title: parsed.title,
        summary: parsed.summary,
        details: parsed.details,
        related_entities: parsed.related_entities,
        provider: toAiProviderType(result.provider),
        tokens_used: result.tokensIn + result.tokensOut,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };

      try {
        await this.redis.setEx(
          cacheKey,
          7 * 24 * 3600,
          JSON.stringify(infoResult),
        );
      } catch (cacheErr) {
        this.logger.warn(
          `Entity info cache write failed (Redis unavailable): ${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}`,
        );
      }

      return infoResult;
    } catch (error) {
      const isTimeout =
        error instanceof Error && error.message.includes('timed out');
      this.logger.error(
        `Entity info generation failed for "${event.entity_text}" ` +
          `[${isTimeout ? 'TIMEOUT' : 'GATEWAY_ERROR'}]: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );

      this.aiMetrics.recordRequest(
        'entity_info',
        'unknown',
        'unknown',
        0,
        0,
        0,
        false,
      );

      return {
        entity_text: event.entity_text,
        entity_type: event.entity_type,
        title: event.entity_text,
        summary: 'Unable to generate information at this time.',
        details: '',
        related_entities: [],
        provider: 'openai',
        tokens_used: 0,
        processed_at: Date.now(),
        trace_id: event.trace_id,
      };
    }
  }

  private parseEntities(
    content: string,
    body: string,
  ): DetectedEntity[] | null {
    let json: unknown;
    try {
      json = parseJsonResponse(content);
    } catch {
      this.logger.warn('Failed to parse entity detection response');
      return null;
    }
    if (!json || typeof json !== 'object' || !('entities' in json)) {
      return null;
    }
    const entitiesRaw = (json as { entities: unknown }).entities;
    if (!Array.isArray(entitiesRaw)) {
      return null;
    }
    return (entitiesRaw as unknown[])
      .map((e) => this.normalizeEntity(e, body))
      .filter((e): e is DetectedEntity => e !== null);
  }

  private normalizeEntity(raw: unknown, body: string): DetectedEntity | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;

    const text = typeof r.text === 'string' ? r.text.trim() : '';
    if (!text) return null;

    // Locate the entity in the body to produce character offsets. The frontend
    // highlighter REQUIRES start_index/end_index; without them every entity is
    // dropped client-side (the entity-highlight feature silently does nothing).
    // Case-insensitive match (the LLM may return a differently-cased form), but
    // the offsets index the ORIGINAL body so the highlighted slice matches what
    // the user sees. We deliberately do NOT trust any offsets the model emits
    // (LLMs routinely miscount) and compute them ourselves.
    const start_index = body.toLowerCase().indexOf(text.toLowerCase());
    if (start_index < 0) return null;
    const end_index = start_index + text.length;

    const type =
      typeof r.type === 'string' &&
      (VALID_ENTITY_TYPES as readonly string[]).includes(r.type)
        ? (r.type as EntityType)
        : 'other';

    const confidence =
      typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1
        ? r.confidence
        : 0;
    if (confidence < MIN_CONFIDENCE) return null;

    return { text, type, confidence, start_index, end_index };
  }

  private parseInfoResponse(
    content: string,
    fallbackTitle: string,
  ): {
    title: string;
    summary: string;
    details: string;
    related_entities: string[];
  } {
    try {
      const json = parseJsonResponse(content) as Record<string, unknown>;
      return {
        title: typeof json.title === 'string' ? json.title : fallbackTitle,
        summary: typeof json.summary === 'string' ? json.summary : '',
        details: typeof json.details === 'string' ? json.details : '',
        related_entities: Array.isArray(json.related_entities)
          ? (json.related_entities as unknown[]).filter(
              (s): s is string => typeof s === 'string',
            )
          : [],
      };
    } catch (err) {
      this.logger.warn(
        `Failed to parse entity info response — ` +
          `error: ${err instanceof Error ? err.message : String(err)} | ` +
          `raw (first 300): ${content.slice(0, 300)}`,
      );
      return {
        title: fallbackTitle,
        summary: 'Unable to generate information at this time.',
        details: '',
        related_entities: [],
      };
    }
  }
}
