/**
 * @file translation.engine.spec.ts
 *
 * Unit tests for TranslationEngine — LLM-based translation with 24h Redis cache.
 *
 * Covers:
 *  - Cache hit: returns cached translation with cached=true
 *  - Cache miss: calls LLM, returns translated text, stores to cache
 *  - Correct cache key derivation (base64url of body + target language)
 *  - Failure fallback: returns original body when LLM throws
 *  - Metrics recorded on success and failure
 *  - Corrupted cache: regenerates on JSON parse error
 */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { TranslationEngine } from './translation.engine';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { PromptBuilderService } from '../ai-gateway/services/prompt-builder.service';
import { AiMetricsService } from '../ai-gateway/services/ai-metrics.service';
import { RedisService } from '@libs/redis';
import type { AiTranslateRequestEvent } from '@libs/contracts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(
  overrides: Partial<AiTranslateRequestEvent> = {},
): AiTranslateRequestEvent {
  return {
    message_id: 'msg-001',
    conversation_id: 'conv-001',
    user_id: 'user-001',
    body: 'Hello, world!',
    source_language: 'en',
    target_language: 'vi',
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

function llmResult(translatedText: string, sourceLang = 'en') {
  return {
    content: JSON.stringify({
      translated_text: translatedText,
      source_language: sourceLang,
    }),
    tokensIn: 60,
    tokensOut: 40,
    model: 'gpt-4o',
    provider: 'openai',
    latencyMs: 180,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TranslationEngine', () => {
  let engine: TranslationEngine;
  let gateway: jest.Mocked<AiGatewayService>;
  let metrics: jest.Mocked<AiMetricsService>;
  let redis: jest.Mocked<RedisService>;

  beforeEach(async () => {
    gateway = makeGateway();
    metrics = makeMetrics();
    redis = makeRedis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranslationEngine,
        { provide: AiGatewayService, useValue: gateway },
        { provide: PromptBuilderService, useClass: PromptBuilderService },
        { provide: AiMetricsService, useValue: metrics },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    engine = module.get(TranslationEngine);

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  // ── Cache hit ─────────────────────────────────────────────────────

  describe('translate() — cache hit', () => {
    it('returns cached translation with cached=true', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          translated_text: 'Xin chào thế giới!',
          source_language: 'en',
          provider: 'openai',
        }),
      );

      const result = await engine.translate(makeEvent());

      expect(result.cached).toBe(true);
      expect(result.translated_body).toBe('Xin chào thế giới!');
      expect(result.tokens_used).toBe(0);
      expect(gateway.complete).not.toHaveBeenCalled();
    });

    it('uses deterministic cache key based on body + target language', async () => {
      const cachedValue = JSON.stringify({
        translated_text: 'Ciao',
        source_language: 'en',
        provider: 'openai',
      });
      redis.get.mockResolvedValue(cachedValue);

      const event = makeEvent({ body: 'Hello', target_language: 'it' });
      await engine.translate(event);

      // The key should contain both a body-derived hash and the target language
      const calledKey = redis.get.mock.calls[0][0];
      expect(calledKey).toMatch(/^ai:translate:.+:it$/);
    });

    it('preserves original_body and target_language in cached result', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          translated_text: 'Hola',
          source_language: 'en',
          provider: 'openai',
        }),
      );

      const result = await engine.translate(
        makeEvent({ body: 'Hello', target_language: 'es' }),
      );

      expect(result.original_body).toBe('Hello');
      expect(result.target_language).toBe('es');
    });
  });

  // ── Cache miss → generate ─────────────────────────────────────────

  describe('translate() — cache miss', () => {
    it('calls LLM and returns translated text', async () => {
      redis.get.mockResolvedValue(null);
      redis.setEx.mockResolvedValue(undefined as unknown);
      gateway.complete.mockResolvedValue(llmResult('Xin chào!'));

      const result = await engine.translate(makeEvent());

      expect(result.translated_body).toBe('Xin chào!');
      expect(result.cached).toBe(false);
    });

    it('stores translation in Redis with 24h TTL', async () => {
      redis.get.mockResolvedValue(null);
      redis.setEx.mockResolvedValue(undefined as unknown);
      gateway.complete.mockResolvedValue(llmResult('Bonjour!', 'en'));

      await engine.translate(makeEvent({ target_language: 'fr' }));

      expect(redis.setEx).toHaveBeenCalledWith(
        expect.stringMatching(/^ai:translate:.+:fr$/),
        86400,
        expect.stringContaining('Bonjour!'),
      );
    });

    it('sets source_language from LLM response', async () => {
      redis.get.mockResolvedValue(null);
      redis.setEx.mockResolvedValue(undefined as unknown);
      gateway.complete.mockResolvedValue(llmResult('Salut!', 'en'));

      const result = await engine.translate(
        makeEvent({ source_language: undefined }),
      );

      expect(result.source_language).toBe('en');
    });

    it('records success metrics', async () => {
      redis.get.mockResolvedValue(null);
      redis.setEx.mockResolvedValue(undefined as unknown);
      gateway.complete.mockResolvedValue(llmResult('Translated'));

      await engine.translate(makeEvent());

      expect(metrics.recordRequest).toHaveBeenCalledWith(
        'translation',
        'openai',
        'gpt-4o',
        60,
        40,
        180,
        true,
      );
    });

    it('calculates tokens_used as tokensIn + tokensOut', async () => {
      redis.get.mockResolvedValue(null);
      redis.setEx.mockResolvedValue(undefined as unknown);
      gateway.complete.mockResolvedValue(llmResult('Done')); // tokensIn=60, tokensOut=40

      const result = await engine.translate(makeEvent());

      expect(result.tokens_used).toBe(100); // 60 + 40
    });

    it('handles non-JSON LLM response (plain text fallback)', async () => {
      redis.get.mockResolvedValue(null);
      redis.setEx.mockResolvedValue(undefined as unknown);
      gateway.complete.mockResolvedValue({
        content: 'Plain translated text',
        tokensIn: 60,
        tokensOut: 40,
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 180,
      });

      const result = await engine.translate(makeEvent());

      expect(result.translated_body).toBe('Plain translated text');
    });
  });

  // ── Failure / fallback ────────────────────────────────────────────

  describe('translate() — failure fallback', () => {
    it('returns original body as translated_body when LLM throws', async () => {
      redis.get.mockResolvedValue(null);
      gateway.complete.mockRejectedValue(new Error('LLM error'));

      const result = await engine.translate(makeEvent({ body: 'Hello' }));

      expect(result.translated_body).toBe('Hello');
      expect(result.cached).toBe(false);
      expect(result.tokens_used).toBe(0);
    });

    it('records failure metrics when LLM throws', async () => {
      redis.get.mockResolvedValue(null);
      gateway.complete.mockRejectedValue(new Error('timeout'));

      await engine.translate(makeEvent());

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

    it('preserves message fields in fallback result', async () => {
      redis.get.mockResolvedValue(null);
      gateway.complete.mockRejectedValue(new Error('fail'));

      const result = await engine.translate(
        makeEvent({
          message_id: 'msg-xyz',
          conversation_id: 'conv-xyz',
          target_language: 'ja',
        }),
      );

      expect(result.message_id).toBe('msg-xyz');
      expect(result.conversation_id).toBe('conv-xyz');
      expect(result.target_language).toBe('ja');
    });
  });

  // ── Corrupted cache ───────────────────────────────────────────────

  describe('translate() — corrupted cache', () => {
    it('regenerates when cached value is invalid JSON', async () => {
      redis.get.mockResolvedValue('{bad json}');
      redis.setEx.mockResolvedValue(undefined as unknown);
      gateway.complete.mockResolvedValue(llmResult('Regenerated'));

      const result = await engine.translate(makeEvent());

      expect(gateway.complete).toHaveBeenCalledTimes(1);
      expect(result.translated_body).toBe('Regenerated');
    });
  });

  // ── Same body, different target language ─────────────────────────

  describe('cache key isolation', () => {
    it('uses different cache keys for different target languages', async () => {
      const cachedFr = JSON.stringify({
        translated_text: 'Bonjour',
        source_language: 'en',
        provider: 'openai',
      });
      const cachedDe = JSON.stringify({
        translated_text: 'Hallo',
        source_language: 'en',
        provider: 'openai',
      });

      redis.get.mockResolvedValueOnce(cachedFr).mockResolvedValueOnce(cachedDe);

      const resultFr = await engine.translate(
        makeEvent({ body: 'Hi', target_language: 'fr' }),
      );
      const resultDe = await engine.translate(
        makeEvent({ body: 'Hi', target_language: 'de' }),
      );

      const keyFr = redis.get.mock.calls[0][0];
      const keyDe = redis.get.mock.calls[1][0];

      expect(keyFr).not.toBe(keyDe);
      expect(keyFr.endsWith(':fr')).toBe(true);
      expect(keyDe.endsWith(':de')).toBe(true);
      expect(resultFr.translated_body).toBe('Bonjour');
      expect(resultDe.translated_body).toBe('Hallo');
    });
  });
});
