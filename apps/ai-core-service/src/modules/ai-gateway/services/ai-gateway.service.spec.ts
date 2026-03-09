/**
 * @file ai-gateway.service.spec.ts
 *
 * Unit tests for AiGatewayService — provider routing with circuit breaker,
 * PII sanitization middleware, and daily token budget enforcement.
 *
 * Covers:
 *  - complete() success path (PII stripped, budget consumed)
 *  - complete() budget exceeded
 *  - complete() all providers fail (error thrown)
 *  - complete() unavailable provider skipped
 *  - Circuit breaker: open after CIRCUIT_THRESHOLD failures
 *  - Circuit breaker: half-open after CIRCUIT_RESET_MS elapsed
 *  - Circuit breaker: reset to closed on success
 *  - embed() delegates to OpenAI provider
 *  - skipSanitize / skipBudgetCheck opts
 */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { AiGatewayService } from './ai-gateway.service';
import { DataSanitizer } from './data-sanitizer.service';
import { TokenBudgetService } from './token-budget.service';
import {
  LLM_PROVIDERS,
  ILlmProvider,
  LlmCompletionResult,
} from '../interfaces';

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function makeResult(
  overrides: Partial<LlmCompletionResult> = {},
): LlmCompletionResult {
  return {
    content: '{"answer":"yes"}',
    tokensIn: 100,
    tokensOut: 50,
    model: 'gpt-4o',
    provider: 'openai',
    latencyMs: 200,
    ...overrides,
  };
}

function makeSanitizer(passthrough = true): jest.Mocked<DataSanitizer> {
  return {
    sanitize: jest.fn((text: string) =>
      passthrough ? text : `[SANITIZED:${text}]`,
    ),
    sanitizeAll: jest.fn((texts: string[]) => texts),
  } as unknown as jest.Mocked<DataSanitizer>;
}

function makeBudget(canConsume = true): jest.Mocked<TokenBudgetService> {
  return {
    canConsume: jest.fn().mockResolvedValue(canConsume),
    consume: jest.fn().mockResolvedValue(150),
    getRemaining: jest.fn().mockResolvedValue(900000),
    getUsage: jest.fn().mockResolvedValue(100000),
  } as unknown as jest.Mocked<TokenBudgetService>;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AiGatewayService', () => {
  let gateway: AiGatewayService;
  let primaryProvider: jest.Mocked<ILlmProvider>;
  let secondaryProvider: jest.Mocked<ILlmProvider>;
  let sanitizer: jest.Mocked<DataSanitizer>;
  let budget: jest.Mocked<TokenBudgetService>;

  const BASE_OPTIONS = {
    messages: [{ role: 'user' as const, content: 'Hello' }],
  };

  beforeEach(async () => {
    primaryProvider = makeProvider('openai');
    secondaryProvider = makeProvider('gemini');
    sanitizer = makeSanitizer();
    budget = makeBudget();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiGatewayService,
        {
          provide: LLM_PROVIDERS,
          useValue: [primaryProvider, secondaryProvider],
        },
        { provide: DataSanitizer, useValue: sanitizer },
        { provide: TokenBudgetService, useValue: budget },
      ],
    }).compile();

    gateway = module.get(AiGatewayService);
  });

  // ── complete — happy path ─────────────────────────────────────────

  describe('complete()', () => {
    it('returns result from the first available provider', async () => {
      const expected = makeResult();
      primaryProvider.complete.mockResolvedValue(expected);

      const result = await gateway.complete('user1', BASE_OPTIONS);

      expect(result).toBe(expected);
      expect(primaryProvider.complete).toHaveBeenCalledTimes(1);
    });

    it('sanitizes message content before calling provider', async () => {
      primaryProvider.complete.mockResolvedValue(makeResult());
      sanitizer.sanitize.mockReturnValue('[SANITIZED]');

      await gateway.complete('user1', {
        messages: [{ role: 'user', content: 'raw content' }],
      });

      expect(sanitizer.sanitize).toHaveBeenCalledWith('raw content');
      const calledWith = primaryProvider.complete.mock.calls[0][0];
      expect(calledWith.messages[0].content).toBe('[SANITIZED]');
    });

    it('skips sanitization when skipSanitize=true', async () => {
      primaryProvider.complete.mockResolvedValue(makeResult());

      await gateway.complete(
        'user1',
        {
          messages: [{ role: 'user', content: 'raw' }],
        },
        { skipSanitize: true },
      );

      expect(sanitizer.sanitize).not.toHaveBeenCalled();
    });

    it('checks budget before calling provider', async () => {
      primaryProvider.complete.mockResolvedValue(makeResult());

      await gateway.complete('user1', BASE_OPTIONS);

      expect(budget.canConsume).toHaveBeenCalledWith(
        'user1',
        expect.any(Number),
      );
    });

    it('skips budget check when skipBudgetCheck=true', async () => {
      primaryProvider.complete.mockResolvedValue(makeResult());

      await gateway.complete('user1', BASE_OPTIONS, { skipBudgetCheck: true });

      expect(budget.canConsume).not.toHaveBeenCalled();
    });

    it('records token consumption after successful call', async () => {
      const result = makeResult({ tokensIn: 200, tokensOut: 100 });
      primaryProvider.complete.mockResolvedValue(result);

      await gateway.complete('user1', BASE_OPTIONS);

      expect(budget.consume).toHaveBeenCalledWith('user1', 300); // 200 + 100
    });

    it('throws when budget is exceeded', async () => {
      budget.canConsume.mockResolvedValue(false);

      await expect(gateway.complete('user1', BASE_OPTIONS)).rejects.toThrow(
        'Daily token budget exceeded',
      );
    });

    it('falls back to secondary provider when primary fails', async () => {
      primaryProvider.complete.mockRejectedValue(new Error('timeout'));
      const fallbackResult = makeResult({ provider: 'gemini' });
      secondaryProvider.complete.mockResolvedValue(fallbackResult);

      const result = await gateway.complete('user1', BASE_OPTIONS);

      expect(result).toBe(fallbackResult);
      expect(secondaryProvider.complete).toHaveBeenCalledTimes(1);
    });

    it('throws when all providers fail', async () => {
      primaryProvider.complete.mockRejectedValue(new Error('openai down'));
      secondaryProvider.complete.mockRejectedValue(new Error('gemini down'));

      await expect(gateway.complete('user1', BASE_OPTIONS)).rejects.toThrow(
        'All LLM providers failed',
      );
    });

    it('skips unavailable providers', async () => {
      // Recreate gateway with one unavailable provider
      const unavailableProvider = makeProvider('openai', false);
      const availableProvider = makeProvider('gemini', true);
      availableProvider.complete.mockResolvedValue(
        makeResult({ provider: 'gemini' }),
      );

      const m = await Test.createTestingModule({
        providers: [
          AiGatewayService,
          {
            provide: LLM_PROVIDERS,
            useValue: [unavailableProvider, availableProvider],
          },
          { provide: DataSanitizer, useValue: sanitizer },
          { provide: TokenBudgetService, useValue: budget },
        ],
      }).compile();

      const gw = m.get(AiGatewayService);
      const result = await gw.complete('user1', BASE_OPTIONS);

      expect(unavailableProvider.complete).not.toHaveBeenCalled();
      expect(result.provider).toBe('gemini');
    });
  });

  // ── Circuit breaker ───────────────────────────────────────────────

  describe('circuit breaker', () => {
    it('opens circuit after 5 consecutive failures', async () => {
      primaryProvider.complete.mockRejectedValue(new Error('fail'));
      secondaryProvider.complete.mockResolvedValue(
        makeResult({ provider: 'gemini' }),
      );

      // Trigger 5 failures on primary: each call falls back to secondary
      for (let i = 0; i < 5; i++) {
        await gateway.complete('user1', BASE_OPTIONS);
      }

      // On 6th call, primary should be skipped (circuit open)
      primaryProvider.complete.mockClear();
      secondaryProvider.complete.mockClear();
      secondaryProvider.complete.mockResolvedValue(
        makeResult({ provider: 'gemini' }),
      );

      await gateway.complete('user1', BASE_OPTIONS);

      expect(primaryProvider.complete).not.toHaveBeenCalled();
    });

    it('resets circuit to closed on successful call', async () => {
      // Trigger 5 failures to open circuit
      primaryProvider.complete.mockRejectedValue(new Error('fail'));
      secondaryProvider.complete.mockResolvedValue(makeResult());

      for (let i = 0; i < 5; i++) {
        await gateway.complete('user1', BASE_OPTIONS);
      }

      // Wait for circuit reset (mock Date.now)
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 35_000);

      // Next call: circuit transitions to half-open, provider succeeds → closed
      primaryProvider.complete.mockResolvedValue(makeResult());
      const result = await gateway.complete('user1', BASE_OPTIONS);

      expect(result.provider).toBe('openai');

      jest.restoreAllMocks();
    });
  });

  // ── embed() ───────────────────────────────────────────────────────

  describe('embed()', () => {
    it('delegates to the openai provider', async () => {
      const mockEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        tokensUsed: 10,
        model: 'text-embedding-3-small',
        provider: 'openai',
      };
      primaryProvider.embed.mockResolvedValue(mockEmbedding);

      const result = await gateway.embed('Hello world');

      expect(result).toBe(mockEmbedding);
      expect(primaryProvider.embed).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
      );
    });

    it('sanitizes text before embedding', async () => {
      sanitizer.sanitize.mockReturnValue('[SANITIZED]');
      primaryProvider.embed.mockResolvedValue({
        embedding: [0.1],
        tokensUsed: 5,
        model: 'text-embedding-3-small',
        provider: 'openai',
      });

      await gateway.embed('user@example.com info');

      expect(sanitizer.sanitize).toHaveBeenCalledWith('user@example.com info');
      expect(primaryProvider.embed).toHaveBeenCalledWith(
        '[SANITIZED]',
        undefined,
      );
    });

    it('throws when OpenAI provider is unavailable', async () => {
      const m = await Test.createTestingModule({
        providers: [
          AiGatewayService,
          { provide: LLM_PROVIDERS, useValue: [makeProvider('openai', false)] },
          { provide: DataSanitizer, useValue: sanitizer },
          { provide: TokenBudgetService, useValue: budget },
        ],
      }).compile();

      const gw = m.get(AiGatewayService);

      await expect(gw.embed('test')).rejects.toThrow(
        'OpenAI provider not available for embeddings',
      );
    });
  });

  // ── getProvider() ─────────────────────────────────────────────────

  describe('getProvider()', () => {
    it('returns provider by name', () => {
      const provider = gateway.getProvider('openai');
      expect(provider).toBe(primaryProvider);
    });

    it('returns undefined for unknown provider', () => {
      const provider = gateway.getProvider('unknown-llm');
      expect(provider).toBeUndefined();
    });
  });
});
