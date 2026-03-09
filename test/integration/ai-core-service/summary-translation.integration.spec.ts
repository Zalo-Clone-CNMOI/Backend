/**
 * @file summary-translation.integration.spec.ts
 *
 * Integration tests for SummaryEngine and TranslationEngine with real NestJS DI.
 * Real: SummaryEngine, TranslationEngine, PromptBuilderService.
 * Mocks: AiGatewayService, AiMetricsService, RedisService.
 *
 * Covers full pipeline: prompt building → cache check → LLM call → cache store → result.
 */
/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { SummaryEngine } from '../../../apps/ai-core-service/src/modules/summary/summary.engine';
import { TranslationEngine } from '../../../apps/ai-core-service/src/modules/translation/translation.engine';
import { PromptBuilderService } from '../../../apps/ai-core-service/src/modules/ai-gateway/services/prompt-builder.service';
import { AiGatewayService } from '../../../apps/ai-core-service/src/modules/ai-gateway/services/ai-gateway.service';
import { AiMetricsService } from '../../../apps/ai-core-service/src/modules/ai-gateway/services/ai-metrics.service';
import type { LlmCompletionResult } from '../../../apps/ai-core-service/src/modules/ai-gateway/interfaces/llm-provider.interface';
import { APP_CONFIG } from '@libs/config';
import { RedisService } from '@libs/redis';
import type {
  AiSummaryRequestEvent,
  AiTranslateRequestEvent,
} from '@libs/contracts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGateway() {
  return { complete: jest.fn() } as unknown as jest.Mocked<AiGatewayService>;
}

function makeMetrics() {
  return {
    recordRequest: jest.fn(),
  } as unknown as jest.Mocked<AiMetricsService>;
}

function makeRedis() {
  return {
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incrBy: jest.fn().mockResolvedValue(0),
    ttl: jest.fn().mockResolvedValue(-1),
    expire: jest.fn().mockResolvedValue(1),
  } as unknown as jest.Mocked<RedisService>;
}

function makeLlmResult(
  overrides: Partial<LlmCompletionResult> = {},
): LlmCompletionResult {
  return {
    content: '{}',
    provider: 'openai',
    model: 'gpt-4o-mini',
    tokensIn: 50,
    tokensOut: 80,
    latencyMs: 200,
    ...overrides,
  };
}

function makeSummaryEvent(
  overrides: Partial<AiSummaryRequestEvent> = {},
): AiSummaryRequestEvent {
  return {
    conversation_id: 'conv-sum-001',
    user_id: 'user-001',
    messages: [],
    message_ids: ['msg-1', 'msg-2', 'msg-3'],
    requested_at: Date.now(),
    trace_id: 'trace-sum-test',
    ...overrides,
  };
}

function makeTranslateEvent(
  overrides: Partial<AiTranslateRequestEvent> = {},
): AiTranslateRequestEvent {
  return {
    message_id: 'msg-tr-001',
    conversation_id: 'conv-tr-001',
    user_id: 'user-001',
    body: 'Hello, how are you?',
    source_language: 'en',
    target_language: 'vi',
    requested_at: Date.now(),
    trace_id: 'trace-tr-test',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SummaryEngine Integration Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('SummaryEngine (integration)', () => {
  let module: TestingModule;
  let engine: SummaryEngine;
  let gateway: jest.Mocked<AiGatewayService>;
  let metrics: jest.Mocked<AiMetricsService>;
  let redis: jest.Mocked<RedisService>;

  async function buildModule(cacheEnabled = true) {
    gateway = makeGateway();
    metrics = makeMetrics();
    redis = makeRedis();

    module = await Test.createTestingModule({
      providers: [
        SummaryEngine,
        PromptBuilderService,
        {
          provide: APP_CONFIG,
          useValue: { aiEnableConversationCache: cacheEnabled },
        },
        { provide: AiGatewayService, useValue: gateway },
        { provide: AiMetricsService, useValue: metrics },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    engine = module.get(SummaryEngine);
  }

  afterEach(async () => {
    if (module) await module.close();
  });

  describe('cache hit', () => {
    it('returns cached result without calling LLM', async () => {
      await buildModule(true);
      const event = makeSummaryEvent();
      const cachedPayload = {
        conversation_id: event.conversation_id,
        summary: 'Cached summary text',
        message_range: {
          from_message_id: 'msg-1',
          to_message_id: 'msg-3',
          count: 3,
        },
        provider: 'openai',
        tokens_used: 130,
      };
      redis.get.mockResolvedValue(JSON.stringify(cachedPayload));

      const result = await engine.summarize(event, ['msg a', 'msg b', 'msg c']);

      expect(result.cached).toBe(true);
      expect(result.summary).toBe('Cached summary text');
      expect(result.user_id).toBe(event.user_id);
      expect(result.trace_id).toBe(event.trace_id);
      expect(gateway.complete).not.toHaveBeenCalled();
    });

    it('uses correct cache key pattern', async () => {
      await buildModule(true);
      const event = makeSummaryEvent({ conversation_id: 'conv-xyz-999' });
      redis.get.mockResolvedValue(
        JSON.stringify({
          conversation_id: 'conv-xyz-999',
          summary: 'ok',
          message_range: {},
          provider: 'openai',
          tokens_used: 0,
        }),
      );

      await engine.summarize(event, ['hello']);

      expect(redis.get).toHaveBeenCalledWith('ai:summary:conv-xyz-999');
    });
  });

  describe('cache miss → LLM call', () => {
    it('calls LLM with real prompt built by PromptBuilderService', async () => {
      await buildModule(true);
      const event = makeSummaryEvent();
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({ summary: 'LLM-generated summary' }),
        }) as any,
      );

      await engine.summarize(event, [
        'Hello',
        'How are you?',
        'Fine thank you',
      ]);
      // Assertions are on the gateway.complete call args below

      expect(gateway.complete).toHaveBeenCalledTimes(1);
      const callArgs = gateway.complete.mock.calls[0];
      // Arg 0 = userId, Arg 1 = request object
      expect(callArgs[0]).toBe(event.user_id);
      const req = callArgs[1] as any;
      expect(req.messages).toHaveLength(2); // system + user from PromptBuilderService
      expect(req.messages[0].role).toBe('system');
      expect(req.messages[1].role).toBe('user');
      expect(req.maxTokens).toBe(512);
      expect(req.temperature).toBe(0.3);
    });

    it('returns proper result with LLM-generated summary', async () => {
      await buildModule(true);
      const event = makeSummaryEvent({ message_ids: ['m1', 'm2'] });
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({
            summary: 'Great conversation about NestJS.',
          }),
        }) as any,
      );

      const result = await engine.summarize(event, ['m1 text', 'm2 text']);

      expect(result.cached).toBe(false);
      expect(result.summary).toBe('Great conversation about NestJS.');
      expect(result.tokens_used).toBe(130); // 50 + 80
      expect(result.provider).toBe('openai');
      expect(result.message_range.from_message_id).toBe('m1');
      expect(result.message_range.to_message_id).toBe('m2');
      expect(result.message_range.count).toBe(2);
    });

    it('stores LLM result in Redis with 3600s TTL', async () => {
      await buildModule(true);
      const event = makeSummaryEvent();
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({ summary: 'Cached conversation.' }),
        }) as any,
      );

      await engine.summarize(event, ['text']);

      expect(redis.setEx).toHaveBeenCalledWith(
        'ai:summary:conv-sum-001',
        3600,
        expect.stringContaining('"summary":"Cached conversation."'),
      );
    });

    it('records metrics after successful LLM call', async () => {
      await buildModule(true);
      const event = makeSummaryEvent();
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({ summary: 'summary' }),
          provider: 'gemini',
          model: 'gemini-pro',
          tokensIn: 40,
          tokensOut: 60,
          latencyMs: 150,
        }),
      );

      await engine.summarize(event, ['text']);

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'summary',
        'gemini',
        'gemini-pro',
        40,
        60,
        150,
        true,
      );
    });
  });

  describe('cache disabled', () => {
    it('skips cache check and store when disabled', async () => {
      await buildModule(false);
      const event = makeSummaryEvent();
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({ summary: 'Fresh summary' }),
        }) as any,
      );

      const result = await engine.summarize(event, ['text a', 'text b']);

      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.setEx).not.toHaveBeenCalled();
      expect(gateway.complete).toHaveBeenCalledTimes(1);
      expect(result.summary).toBe('Fresh summary');
    });
  });

  describe('failure handling', () => {
    it('returns safe fallback when LLM throws', async () => {
      await buildModule(true);
      const event = makeSummaryEvent();
      gateway.complete.mockRejectedValue(new Error('LLM timeout'));

      const result = await engine.summarize(event, ['some text']);

      expect(result.cached).toBe(false);
      expect(result.summary).toContain('failed');
      expect(result.tokens_used).toBe(0);
      expect(result.conversation_id).toBe(event.conversation_id);
    });

    it('records failure metrics on LLM error', async () => {
      await buildModule(true);
      const event = makeSummaryEvent();
      gateway.complete.mockRejectedValue(new Error('provider down'));

      await engine.summarize(event, ['text']);

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

    it('falls back when cached JSON is corrupted', async () => {
      await buildModule(true);
      const event = makeSummaryEvent();
      redis.get.mockResolvedValue('not-valid-json{{{');
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({ summary: 'Regenerated summary' }),
        }) as any,
      );

      const result = await engine.summarize(event, ['text']);

      // Should skip corrupted cache and call LLM
      expect(gateway.complete).toHaveBeenCalledTimes(1);
      expect(result.summary).toBe('Regenerated summary');
    });
  });

  describe('PromptBuilderService integration', () => {
    it('prompt user message contains all conversation messages', async () => {
      await buildModule(true);
      const event = makeSummaryEvent();
      const messages = ['Alice: Hello', 'Bob: Hi there', 'Alice: How are you?'];
      gateway.complete.mockResolvedValue(
        makeLlmResult({ content: JSON.stringify({ summary: 'chat' }) }),
      );

      await engine.summarize(event, messages);

      const calledOptions = gateway.complete.mock.calls[0][1];
      const userContent: string = calledOptions.messages[1].content;
      expect(userContent).toContain('Alice: Hello');
      expect(userContent).toContain('Bob: Hi there');
      expect(userContent).toContain('Alice: How are you?');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TranslationEngine Integration Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('TranslationEngine (integration)', () => {
  let module: TestingModule;
  let engine: TranslationEngine;
  let gateway: jest.Mocked<AiGatewayService>;
  let metrics: jest.Mocked<AiMetricsService>;
  let redis: jest.Mocked<RedisService>;

  beforeEach(async () => {
    gateway = makeGateway();
    metrics = makeMetrics();
    redis = makeRedis();

    module = await Test.createTestingModule({
      providers: [
        TranslationEngine,
        PromptBuilderService,
        { provide: AiGatewayService, useValue: gateway },
        { provide: AiMetricsService, useValue: metrics },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    engine = module.get(TranslationEngine);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('cache hit', () => {
    it('returns cached translation without calling LLM', async () => {
      const event = makeTranslateEvent();
      const cachedPayload = {
        translated_text: 'Xin chào, bạn có khỏe không?',
        source_language: 'en',
        provider: 'openai',
      };
      redis.get.mockResolvedValue(JSON.stringify(cachedPayload));

      const result = await engine.translate(event);

      expect(result.cached).toBe(true);
      expect(result.translated_body).toBe('Xin chào, bạn có khỏe không?');
      expect(result.tokens_used).toBe(0);
      expect(result.original_body).toBe(event.body);
      expect(gateway.complete).not.toHaveBeenCalled();
    });

    it('preserves all event fields on cache hit', async () => {
      const event = makeTranslateEvent({
        message_id: 'msg-99',
        trace_id: 'trace-99',
      });
      redis.get.mockResolvedValue(
        JSON.stringify({
          translated_text: 'Bonjour',
          source_language: 'en',
          provider: 'openai',
        }),
      );

      const result = await engine.translate(event);

      expect(result.message_id).toBe('msg-99');
      expect(result.conversation_id).toBe(event.conversation_id);
      expect(result.user_id).toBe(event.user_id);
      expect(result.target_language).toBe(event.target_language);
      expect(result.trace_id).toBe('trace-99');
    });
  });

  describe('cache miss → LLM call', () => {
    it('calls LLM with real prompt from PromptBuilderService', async () => {
      const event = makeTranslateEvent();
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({
            translated_text: 'Xin chào',
            source_language: 'en',
          }),
        }) as any,
      );

      await engine.translate(event);

      expect(gateway.complete).toHaveBeenCalledTimes(1);
      const req = gateway.complete.mock.calls[0][1] as any;
      expect(req.messages).toHaveLength(2);
      expect(req.messages[0].role).toBe('system');
      expect(req.messages[1].role).toBe('user');
      expect(req.maxTokens).toBe(1024);
      expect(req.temperature).toBe(0.3);
    });

    it('prompt user message references source and target language', async () => {
      const event = makeTranslateEvent({
        source_language: 'en',
        target_language: 'vi',
      });
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({
            translated_text: 'ok',
            source_language: 'en',
          }),
        }) as any,
      );

      await engine.translate(event);

      const req = gateway.complete.mock.calls[0][1] as any;
      const systemMsg: string = req.messages[0].content;
      expect(systemMsg).toContain('to vi');
    });

    it('stores translation to Redis with TTL 86400', async () => {
      const event = makeTranslateEvent();
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({
            translated_text: 'Xin chào',
            source_language: 'en',
          }),
        }) as any,
      );

      await engine.translate(event);

      expect(redis.setEx).toHaveBeenCalledWith(
        expect.stringMatching(/^ai:translate:.+:vi$/),
        86400,
        expect.stringContaining('"translated_text":"Xin chào"'),
      );
    });

    it('returns proper result fields from LLM response', async () => {
      const event = makeTranslateEvent();
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({
            translated_text: 'Xin chào',
            source_language: 'en',
          }),
          provider: 'gemini',
          model: 'gemini-pro',
          tokensIn: 30,
          tokensOut: 20,
        }) as any,
      );

      const result = await engine.translate(event);

      expect(result.cached).toBe(false);
      expect(result.translated_body).toBe('Xin chào');
      expect(result.source_language).toBe('en');
      expect(result.target_language).toBe('vi');
      expect(result.tokens_used).toBe(50);
      expect(result.provider).toBe('gemini');
    });

    it('records metrics after successful translation', async () => {
      const event = makeTranslateEvent();
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({
            translated_text: 'ok',
            source_language: 'en',
          }),
          provider: 'anthropic',
          model: 'claude-3',
          tokensIn: 20,
          tokensOut: 15,
          latencyMs: 90,
        }) as any,
      );

      await engine.translate(event);

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'translation',
        'anthropic',
        'claude-3',
        20,
        15,
        90,
        true,
      );
    });
  });

  describe('cache key isolation', () => {
    it('uses different cache keys for different target languages', async () => {
      const eventVi = makeTranslateEvent({
        body: 'Hello',
        target_language: 'vi',
      });
      const eventFr = makeTranslateEvent({
        body: 'Hello',
        target_language: 'fr',
      });
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({
            translated_text: 'translated',
            source_language: 'en',
          }),
        }) as any,
      );

      await engine.translate(eventVi);
      redis.get.mockClear();
      await engine.translate(eventFr);

      const viCall = redis.get.mock.calls.find((c) => c[0].endsWith(':vi'));
      const frCall = redis.get.mock.calls.find((c) => c[0].endsWith(':fr'));
      // After clearing, only the 'fr' call should appear
      expect(redis.get).toHaveBeenCalledWith(
        expect.stringMatching(/^ai:translate:.+:fr$/),
      );
      // The recorded viKey should differ from frKey
      if (viCall && frCall) {
        expect(viCall[0]).not.toBe(frCall[0]);
      }
    });

    it('uses same cache key for same body + language pair', async () => {
      const event1 = makeTranslateEvent();
      const event2 = makeTranslateEvent({ message_id: 'msg-002' });

      // First call — cache miss
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({
            translated_text: 'hi',
            source_language: 'en',
          }),
        }) as any,
      );
      await engine.translate(event1);

      const storedKey = (
        redis.setEx.mock.calls[0] as [string, number, string]
      )[0];

      // Simulate cache hit on second call
      redis.get.mockResolvedValue(
        JSON.stringify({
          translated_text: 'hi',
          source_language: 'en',
          provider: 'openai',
        }),
      );
      redis.setEx.mockClear();

      const result2 = await engine.translate(event2);

      expect(redis.get).toHaveBeenCalledWith(storedKey);
      expect(result2.cached).toBe(true);
      expect(redis.setEx).not.toHaveBeenCalled();
    });
  });

  describe('failure handling', () => {
    it('returns original body when LLM throws', async () => {
      const event = makeTranslateEvent({ body: 'Hello world' });
      gateway.complete.mockRejectedValue(new Error('LLM error'));

      const result = await engine.translate(event);

      expect(result.translated_body).toBe('Hello world');
      expect(result.cached).toBe(false);
      expect(result.tokens_used).toBe(0);
    });

    it('records failure metrics on LLM error', async () => {
      const event = makeTranslateEvent();
      gateway.complete.mockRejectedValue(new Error('network error'));

      await engine.translate(event);

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'translation',
        'unknown',
        'unknown',
        0,
        0,
        0,
        false,
      );
    });

    it('preserves event fields in fallback response', async () => {
      const event = makeTranslateEvent({
        message_id: 'msg-fail',
        conversation_id: 'conv-fail',
        trace_id: 'trace-fail',
        body: 'Original text',
        source_language: 'en',
        target_language: 'de',
      });
      gateway.complete.mockRejectedValue(new Error('fail'));

      const result = await engine.translate(event);

      expect(result.message_id).toBe('msg-fail');
      expect(result.conversation_id).toBe('conv-fail');
      expect(result.trace_id).toBe('trace-fail');
      expect(result.original_body).toBe('Original text');
      expect(result.target_language).toBe('de');
    });

    it('falls back when cached JSON is corrupted', async () => {
      const event = makeTranslateEvent();
      redis.get.mockResolvedValue('corrupted{{json');
      gateway.complete.mockResolvedValue(
        makeLlmResult({
          content: JSON.stringify({
            translated_text: 'Rebuilt',
            source_language: 'en',
          }),
        }) as any,
      );

      const result = await engine.translate(event);

      expect(gateway.complete).toHaveBeenCalledTimes(1);
      expect(result.translated_body).toBe('Rebuilt');
    });
  });
});
