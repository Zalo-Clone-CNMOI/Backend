/**
 * @file summary.engine.spec.ts
 *
 * Unit tests for SummaryEngine — conversation summarization with Redis cache.
 *
 * Covers:
 *  - Cache hit: returns cached value with cached=true, no LLM call
 *  - Cache miss: calls LLM, generates summary, stores to cache
 *  - Success path: correct result shape including message_range
 *  - Failure path: graceful fallback when LLM throws
 *  - Cache disabled: always generates, never reads/writes cache
 *  - Corrupted cache: regenerates on parse error
 */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { SummaryEngine } from './summary.engine';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { APP_CONFIG } from '@libs/config';
import { RedisService } from '@libs/redis';
import type { AiSummaryRequestEvent } from '@libs/contracts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(
  overrides: Partial<AiSummaryRequestEvent> = {},
): AiSummaryRequestEvent {
  return {
    conversation_id: 'conv-001',
    user_id: 'user-001',
    messages: ['Alice: Hi Bob', 'Bob: Hey Alice', 'Alice: How are you?'],
    message_ids: ['m1', 'm2', 'm3'],
    requested_at: Date.now(),
    trace_id: 'trace-001',
    ...overrides,
  };
}

function makeGateway(): jest.Mocked<AiGatewayService> {
  return { complete: jest.fn() } as unknown as jest.Mocked<AiGatewayService>;
}

function makeMetrics(): jest.Mocked<AiMetricsService> {
  return {
    recordRequest: jest.fn(),
  } as unknown as jest.Mocked<AiMetricsService>;
}

function makeRedis(): jest.Mocked<RedisService> {
  return {
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
    incrBy: jest.fn(),
    ttl: jest.fn(),
    expire: jest.fn(),
  } as unknown as jest.Mocked<RedisService>;
}

function llmResult(content: string) {
  return {
    content,
    tokensIn: 150,
    tokensOut: 80,
    model: 'gpt-4o',
    provider: 'openai',
    latencyMs: 300,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SummaryEngine', () => {
  let engine: SummaryEngine;
  let gateway: jest.Mocked<AiGatewayService>;
  let metrics: jest.Mocked<AiMetricsService>;
  let redis: jest.Mocked<RedisService>;

  beforeEach(async () => {
    gateway = makeGateway();
    metrics = makeMetrics();
    redis = makeRedis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SummaryEngine,
        { provide: APP_CONFIG, useValue: { aiEnableConversationCache: true } },
        { provide: AiGatewayService, useValue: gateway },
        { provide: PromptBuilderService, useClass: PromptBuilderService },
        { provide: AiMetricsService, useValue: metrics },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    engine = module.get(SummaryEngine);
  });

  // ── Cache hit ─────────────────────────────────────────────────────

  describe('summarize() — cache hit', () => {
    it('returns cached result with cached=true', async () => {
      const cached = {
        conversation_id: 'conv-001',
        summary: 'A quick chat about greetings.',
        message_range: { from_message_id: 'm1', to_message_id: 'm3', count: 3 },
        provider: 'openai',
        tokens_used: 230,
      };
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await engine.summarize(makeEvent(), []);

      expect(result.cached).toBe(true);
      expect(result.summary).toBe('A quick chat about greetings.');
      expect(gateway.complete).not.toHaveBeenCalled();
    });

    it('uses ai:summary:{conversationId} as cache key', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          conversation_id: 'conv-001',
          summary: 'Summary',
          message_range: {
            from_message_id: 'm1',
            to_message_id: 'm3',
            count: 3,
          },
          provider: 'openai',
          tokens_used: 100,
        }),
      );

      await engine.summarize(makeEvent({ conversation_id: 'conv-xyz' }), []);

      expect(redis.get).toHaveBeenCalledWith('ai:summary:conv-xyz');
    });

    it('injects current user_id into cached result', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          conversation_id: 'conv-001',
          summary: 'Cached summary.',
          message_range: {
            from_message_id: 'm1',
            to_message_id: 'm3',
            count: 3,
          },
          provider: 'openai',
          tokens_used: 100,
        }),
      );

      const result = await engine.summarize(
        makeEvent({ user_id: 'user-current' }),
        [],
      );

      expect(result.user_id).toBe('user-current');
    });
  });

  // ── Cache miss → generate ─────────────────────────────────────────

  describe('summarize() — cache miss', () => {
    it('calls LLM and returns generated summary', async () => {
      redis.get.mockResolvedValue(null);
      redis.setEx.mockResolvedValue(undefined);
      gateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ summary: 'A short summary.' })),
      );

      const result = await engine.summarize(makeEvent(), [
        'msg1',
        'msg2',
        'msg3',
      ]);

      expect(result.summary).toBe('A short summary.');
      expect(result.cached).toBe(false);
    });

    it('stores generated summary in Redis cache', async () => {
      redis.get.mockResolvedValue(null);
      redis.setEx.mockResolvedValue(undefined);
      gateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ summary: 'Stored summary.' })),
      );

      await engine.summarize(makeEvent(), []);

      expect(redis.setEx).toHaveBeenCalledWith(
        'ai:summary:conv-001',
        3600,
        expect.stringContaining('Stored summary.'),
      );
    });

    it('sets correct message_range from message_ids', async () => {
      redis.get.mockResolvedValue(null);
      redis.setEx.mockResolvedValue(undefined);
      gateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ summary: 'Summary' })),
      );

      const result = await engine.summarize(
        makeEvent({
          message_ids: ['first', 'middle', 'last'],
          messages: ['m1', 'm2', 'm3'],
        }),
        ['m1', 'm2', 'm3'],
      );

      expect(result.message_range.from_message_id).toBe('first');
      expect(result.message_range.to_message_id).toBe('last');
      expect(result.message_range.count).toBe(3);
    });

    it('records success metrics', async () => {
      redis.get.mockResolvedValue(null);
      redis.setEx.mockResolvedValue(undefined);
      gateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ summary: 'Done' })),
      );

      await engine.summarize(makeEvent(), []);

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'summary',
        'openai',
        'gpt-4o',
        150,
        80,
        300,
        true,
      );
    });

    it('handles plain-text LLM response (non-JSON)', async () => {
      redis.get.mockResolvedValue(null);
      redis.setEx.mockResolvedValue(undefined);
      gateway.complete.mockResolvedValue(llmResult('A plain text summary.'));

      const result = await engine.summarize(makeEvent(), []);

      expect(result.summary).toBe('A plain text summary.');
    });
  });

  // ── Failure / fallback ────────────────────────────────────────────

  describe('summarize() — failure fallback', () => {
    it('returns failure summary when LLM throws', async () => {
      redis.get.mockResolvedValue(null);
      gateway.complete.mockRejectedValue(new Error('LLM error'));

      const result = await engine.summarize(makeEvent(), []);

      expect(result.summary).toContain('failed');
      expect(result.cached).toBe(false);
      expect(result.tokens_used).toBe(0);
    });

    it('records failure metrics when LLM throws', async () => {
      redis.get.mockResolvedValue(null);
      gateway.complete.mockRejectedValue(new Error('timeout'));

      await engine.summarize(makeEvent(), []);

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'summary',
        'unknown',
        'unknown',
        0,
        0,
        0,
        false,
      );
    });

    it('preserves conversation_id in fallback result', async () => {
      redis.get.mockResolvedValue(null);
      gateway.complete.mockRejectedValue(new Error('fail'));

      const result = await engine.summarize(
        makeEvent({ conversation_id: 'c-xyz' }),
        [],
      );

      expect(result.conversation_id).toBe('c-xyz');
    });
  });

  // ── Corrupted cache ───────────────────────────────────────────────

  describe('summarize() — corrupted cache', () => {
    it('regenerates when cached value is invalid JSON', async () => {
      redis.get.mockResolvedValue('{invalid json}');
      redis.setEx.mockResolvedValue(undefined);
      gateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ summary: 'Regenerated.' })),
      );

      const result = await engine.summarize(makeEvent(), []);

      expect(gateway.complete).toHaveBeenCalledTimes(1);
      expect(result.summary).toBe('Regenerated.');
    });
  });

  // ── Cache disabled ────────────────────────────────────────────────

  describe('summarize() — cache disabled', () => {
    it('does not read or write Redis when cache is disabled', async () => {
      const moduleNoCache = await Test.createTestingModule({
        providers: [
          SummaryEngine,
          {
            provide: APP_CONFIG,
            useValue: { aiEnableConversationCache: false },
          },
          { provide: AiGatewayService, useValue: gateway },
          { provide: PromptBuilderService, useClass: PromptBuilderService },
          { provide: AiMetricsService, useValue: metrics },
          { provide: RedisService, useValue: redis },
        ],
      }).compile();

      const noCacheEngine = moduleNoCache.get(SummaryEngine);
      gateway.complete.mockResolvedValue(
        llmResult(JSON.stringify({ summary: 'Fresh.' })),
      );

      const result = await noCacheEngine.summarize(makeEvent(), []);

      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.setEx).not.toHaveBeenCalled();
      expect(result.summary).toBe('Fresh.');
    });
  });
});
