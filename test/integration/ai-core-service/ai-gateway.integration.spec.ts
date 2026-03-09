/**
 * @file ai-gateway.integration.spec.ts
 *
 * Integration tests for AiGatewayService with real NestJS DI.
 * Tests the full pipeline: DataSanitizer + TokenBudgetService + provider fallback.
 *
 * Mock boundary: LLM providers (ILlmProvider), RedisService.
 * Real components: AiGatewayService, DataSanitizer, TokenBudgetService.
 */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { AiGatewayService } from '../../../apps/ai-core-service/src/modules/ai-gateway/services/ai-gateway.service';
import { DataSanitizer } from '../../../apps/ai-core-service/src/modules/ai-gateway/services/data-sanitizer.service';
import { TokenBudgetService } from '../../../apps/ai-core-service/src/modules/ai-gateway/services/token-budget.service';
import {
  LLM_PROVIDERS,
  ILlmProvider,
  LlmCompletionResult,
} from '../../../apps/ai-core-service/src/modules/ai-gateway/interfaces';
import { APP_CONFIG } from '@libs/config';
import { RedisService } from '@libs/redis';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProvider(
  name: string,
  available = true,
): jest.Mocked<ILlmProvider> {
  return {
    name,
    isAvailable: available,
    complete: jest.fn(),
    completeStream: jest.fn(),
    embed: jest.fn(),
  } as unknown as jest.Mocked<ILlmProvider>;
}

function makeRedis(): jest.Mocked<RedisService> {
  return {
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue(undefined),
    del: jest.fn(),
    incrBy: jest.fn().mockResolvedValue(100),
    ttl: jest.fn().mockResolvedValue(3600),
    expire: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<RedisService>;
}

function makeResult(
  overrides: Partial<LlmCompletionResult> = {},
): LlmCompletionResult {
  return {
    content: '{"answer":"ok"}',
    tokensIn: 50,
    tokensOut: 30,
    model: 'gpt-4o',
    provider: 'openai',
    latencyMs: 100,
    ...overrides,
  };
}

const BASE_MESSAGES = [{ role: 'user' as const, content: 'Hello' }];

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('AiGatewayService (integration)', () => {
  let gateway: AiGatewayService;
  let openai: jest.Mocked<ILlmProvider>;
  let gemini: jest.Mocked<ILlmProvider>;
  let redis: jest.Mocked<RedisService>;

  beforeEach(async () => {
    openai = makeProvider('openai');
    gemini = makeProvider('gemini');
    redis = makeRedis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiGatewayService,
        DataSanitizer,
        TokenBudgetService,
        {
          provide: LLM_PROVIDERS,
          useValue: [openai, gemini],
        },
        {
          provide: APP_CONFIG,
          useValue: {
            aiEnablePiiSanitization: true,
            aiDailyTokenBudget: 100_000,
          },
        },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    gateway = module.get(AiGatewayService);
  });

  // ── Basic routing ─────────────────────────────────────────────────

  describe('complete() — provider routing', () => {
    it('routes to the first available provider', async () => {
      openai.complete.mockResolvedValue(makeResult());

      const result = await gateway.complete('user-1', {
        messages: BASE_MESSAGES,
      });

      expect(result.provider).toBe('openai');
      expect(openai.complete).toHaveBeenCalledTimes(1);
      expect(gemini.complete).not.toHaveBeenCalled();
    });

    it('falls back to second provider when first fails', async () => {
      openai.complete.mockRejectedValue(new Error('OpenAI down'));
      gemini.complete.mockResolvedValue(makeResult({ provider: 'gemini' }));

      const result = await gateway.complete('user-1', {
        messages: BASE_MESSAGES,
      });

      expect(result.provider).toBe('gemini');
      expect(openai.complete).toHaveBeenCalledTimes(1);
      expect(gemini.complete).toHaveBeenCalledTimes(1);
    });

    it('throws descriptive error when all providers fail', async () => {
      openai.complete.mockRejectedValue(new Error('openai error'));
      gemini.complete.mockRejectedValue(new Error('gemini error'));

      await expect(
        gateway.complete('user-1', { messages: BASE_MESSAGES }),
      ).rejects.toThrow(/All LLM providers failed/);
    });
  });

  // ── PII Sanitization Integration ─────────────────────────────────

  describe('complete() — PII sanitization', () => {
    it('strips email before sending to provider', async () => {
      openai.complete.mockResolvedValue(makeResult());

      await gateway.complete('user-1', {
        messages: [{ role: 'user', content: 'Contact us at support@acme.com' }],
      });

      const calledMessages = openai.complete.mock.calls[0][0].messages;
      expect(calledMessages[0].content).toContain('[EMAIL]');
      expect(calledMessages[0].content).not.toContain('support@acme.com');
    });

    it('strips IP address before sending to provider', async () => {
      openai.complete.mockResolvedValue(makeResult());

      await gateway.complete('user-1', {
        messages: [{ role: 'user', content: 'Server at 192.168.1.1' }],
      });

      const calledMessages = openai.complete.mock.calls[0][0].messages;
      expect(calledMessages[0].content).toContain('[IP_ADDRESS]');
      expect(calledMessages[0].content).not.toContain('192.168.1.1');
    });

    it('passes content unchanged with skipSanitize=true', async () => {
      openai.complete.mockResolvedValue(makeResult());
      const rawContent = 'Email: admin@test.com';

      await gateway.complete(
        'user-1',
        {
          messages: [{ role: 'user', content: rawContent }],
        },
        { skipSanitize: true },
      );

      const calledMessages = openai.complete.mock.calls[0][0].messages;
      expect(calledMessages[0].content).toBe(rawContent);
    });
  });

  // ── Budget Integration ────────────────────────────────────────────

  describe('complete() — token budget enforcement', () => {
    it('allows request when user is within daily budget', async () => {
      redis.get.mockResolvedValue('1000'); // 1000 used of 100000
      openai.complete.mockResolvedValue(makeResult());

      await expect(
        gateway.complete('user-1', { messages: BASE_MESSAGES }),
      ).resolves.not.toThrow();
    });

    it('rejects request when user exceeds daily budget', async () => {
      redis.get.mockResolvedValue('99999'); // 99999 used; canConsume(2000) → 101999 > 100000

      await expect(
        gateway.complete('user-1', { messages: BASE_MESSAGES }),
      ).rejects.toThrow('Daily token budget exceeded');
    });

    it('records token consumption after successful call', async () => {
      redis.get.mockResolvedValue('0');
      openai.complete.mockResolvedValue(
        makeResult({ tokensIn: 100, tokensOut: 60 }),
      );
      redis.incrBy.mockResolvedValue(160);
      redis.ttl.mockResolvedValue(3600);

      await gateway.complete('user-1', { messages: BASE_MESSAGES });

      expect(redis.incrBy).toHaveBeenCalledWith(
        expect.stringMatching(/^ai:budget:user-1:\d{8}$/),
        160, // 100 + 60
      );
    });
  });

  // ── Circuit Breaker ───────────────────────────────────────────────

  describe('circuit breaker', () => {
    it('opens circuit after 5 provider failures and routes to fallback', async () => {
      openai.complete.mockRejectedValue(new Error('fail'));
      gemini.complete.mockResolvedValue(makeResult({ provider: 'gemini' }));
      redis.get.mockResolvedValue('0');
      redis.incrBy.mockResolvedValue(80);
      redis.ttl.mockResolvedValue(3600);

      // 5 calls to open the circuit
      for (let i = 0; i < 5; i++) {
        await gateway.complete('user-1', { messages: BASE_MESSAGES });
      }

      openai.complete.mockClear();
      gemini.complete.mockClear();
      gemini.complete.mockResolvedValue(makeResult({ provider: 'gemini' }));

      // 6th call: openai circuit open → goes straight to gemini
      await gateway.complete('user-1', { messages: BASE_MESSAGES });

      expect(openai.complete).not.toHaveBeenCalled();
      expect(gemini.complete).toHaveBeenCalledTimes(1);
    });
  });

  // ── embed() ───────────────────────────────────────────────────────

  describe('embed()', () => {
    it('uses OpenAI provider for embeddings', async () => {
      openai.embed.mockResolvedValue({
        embedding: [0.1, 0.2],
        tokensUsed: 5,
        model: 'text-embedding-3-small',
        provider: 'openai',
      });

      const result = await gateway.embed('Hello world');

      expect(result.embedding).toEqual([0.1, 0.2]);
      expect(openai.embed).toHaveBeenCalledTimes(1);
    });

    it('sanitizes text before embedding', async () => {
      openai.embed.mockResolvedValue({
        embedding: [0.9],
        tokensUsed: 3,
        model: 'text-embedding-3-small',
        provider: 'openai',
      });

      await gateway.embed('user@private.com plain text');

      const calledText = openai.embed.mock.calls[0][0];
      expect(calledText).toContain('[EMAIL]');
      expect(calledText).not.toContain('user@private.com');
    });
  });
});
