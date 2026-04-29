import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AiGatewayService } from './ai-gateway.service';
import { DataSanitizer } from './data-sanitizer.service';
import { TokenBudgetService } from './token-budget.service';
import { AiMetricsService } from './ai-metrics.service';
import {
  LLM_PROVIDERS,
  ILlmProvider,
  LlmCompletionResult,
} from '../interfaces';

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
    embedBatch: jest.fn(),
  } as jest.Mocked<ILlmProvider>;
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

function makeMetrics(): jest.Mocked<AiMetricsService> {
  return {
    recordRequest: jest.fn(),
    setCircuitState: jest.fn(),
  } as unknown as jest.Mocked<AiMetricsService>;
}

describe('AiGatewayService', () => {
  let gateway: AiGatewayService;
  let primaryProvider: jest.Mocked<ILlmProvider>;
  let secondaryProvider: jest.Mocked<ILlmProvider>;
  let sanitizer: jest.Mocked<DataSanitizer>;
  let budget: jest.Mocked<TokenBudgetService>;
  let metrics: jest.Mocked<AiMetricsService>;

  const BASE_OPTIONS = {
    messages: [{ role: 'user' as const, content: 'Hello' }],
  };

  beforeEach(async () => {
    primaryProvider = makeProvider('openai');
    secondaryProvider = makeProvider('gemini');
    sanitizer = makeSanitizer();
    budget = makeBudget();
    metrics = makeMetrics();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiGatewayService,
        {
          provide: LLM_PROVIDERS,
          useValue: [primaryProvider, secondaryProvider],
        },
        { provide: DataSanitizer, useValue: sanitizer },
        { provide: TokenBudgetService, useValue: budget },
        { provide: AiMetricsService, useValue: metrics },
      ],
    }).compile();

    gateway = module.get(AiGatewayService);

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

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

      expect(budget.consume).toHaveBeenCalledWith('user1', 300);
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
          { provide: AiMetricsService, useValue: metrics },
        ],
      }).compile();

      const gw = m.get(AiGatewayService);
      const result = await gw.complete('user1', BASE_OPTIONS);

      expect(unavailableProvider.complete).not.toHaveBeenCalled();
      expect(result.provider).toBe('gemini');
    });
  });

  describe('circuit breaker', () => {
    it('opens circuit after 5 consecutive failures', async () => {
      primaryProvider.complete.mockRejectedValue(new Error('fail'));
      secondaryProvider.complete.mockResolvedValue(
        makeResult({ provider: 'gemini' }),
      );

      for (let i = 0; i < 5; i++) {
        await gateway.complete('user1', BASE_OPTIONS);
      }

      primaryProvider.complete.mockClear();
      secondaryProvider.complete.mockClear();
      secondaryProvider.complete.mockResolvedValue(
        makeResult({ provider: 'gemini' }),
      );

      await gateway.complete('user1', BASE_OPTIONS);

      expect(primaryProvider.complete).not.toHaveBeenCalled();
    });

    it('resets circuit to closed on successful call', async () => {
      primaryProvider.complete.mockRejectedValue(new Error('fail'));
      secondaryProvider.complete.mockResolvedValue(makeResult());

      for (let i = 0; i < 5; i++) {
        await gateway.complete('user1', BASE_OPTIONS);
      }

      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 35_000);

      primaryProvider.complete.mockResolvedValue(makeResult());
      const result = await gateway.complete('user1', BASE_OPTIONS);

      expect(result.provider).toBe('openai');

      jest.restoreAllMocks();
    });
  });

  describe('embed()', () => {
    it('delegates to the openai provider', async () => {
      const mockEmbedding = {
        embedding: [0.1, 0.2, 0.3],
        tokensUsed: 10,
        model: 'text-embedding-3-small',
        provider: 'openai',
      };
      primaryProvider.embed.mockResolvedValue(mockEmbedding);

      const result = await gateway.embed('user-001', 'Hello world');

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

      await gateway.embed('user-001', 'user@example.com info');

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
          { provide: AiMetricsService, useValue: metrics },
        ],
      }).compile();

      const gw = m.get(AiGatewayService);

      await expect(gw.embed('user-001', 'test')).rejects.toThrow(
        'OpenAI provider not available for embeddings',
      );
    });
  });

  describe('embedBatch()', () => {
    it('returns empty array without calling provider for empty input', async () => {
      const result = await gateway.embedBatch('user-001', []);
      expect(result).toEqual([]);
      expect(primaryProvider.embedBatch).not.toHaveBeenCalled();
    });

    it('delegates to the openai provider with sanitized texts', async () => {
      const batchResult = [
        {
          embedding: [0.1],
          tokensUsed: 5,
          model: 'text-embedding-3-small',
          provider: 'openai',
        },
        {
          embedding: [0.2],
          tokensUsed: 5,
          model: 'text-embedding-3-small',
          provider: 'openai',
        },
      ];
      primaryProvider.embedBatch.mockResolvedValue(batchResult);

      const result = await gateway.embedBatch('user-001', ['hello', 'world']);

      expect(result).toBe(batchResult);
      expect(primaryProvider.embedBatch).toHaveBeenCalledWith(
        ['hello', 'world'],
        undefined,
      );
    });

    it('sanitizes each text before batch embedding', async () => {
      sanitizer.sanitize.mockReturnValue('[SANITIZED]');
      primaryProvider.embedBatch.mockResolvedValue([
        {
          embedding: [0.1],
          tokensUsed: 5,
          model: 'text-embedding-3-small',
          provider: 'openai',
        },
      ]);

      await gateway.embedBatch('user-001', ['user@example.com info']);

      expect(sanitizer.sanitize).toHaveBeenCalledWith('user@example.com info');
      expect(primaryProvider.embedBatch).toHaveBeenCalledWith(
        ['[SANITIZED]'],
        undefined,
      );
    });

    it('throws when daily token budget is exceeded', async () => {
      const noBudget = makeBudget(false);
      const m = await Test.createTestingModule({
        providers: [
          AiGatewayService,
          { provide: LLM_PROVIDERS, useValue: [primaryProvider] },
          { provide: DataSanitizer, useValue: sanitizer },
          { provide: TokenBudgetService, useValue: noBudget },
          { provide: AiMetricsService, useValue: metrics },
        ],
      }).compile();
      const gw = m.get(AiGatewayService);

      await expect(gw.embedBatch('user-001', ['text'])).rejects.toThrow(
        'Daily token budget exceeded',
      );
      expect(primaryProvider.embedBatch).not.toHaveBeenCalled();
    });

    it('throws when OpenAI provider is unavailable', async () => {
      const m = await Test.createTestingModule({
        providers: [
          AiGatewayService,
          { provide: LLM_PROVIDERS, useValue: [makeProvider('openai', false)] },
          { provide: DataSanitizer, useValue: sanitizer },
          { provide: TokenBudgetService, useValue: budget },
          { provide: AiMetricsService, useValue: metrics },
        ],
      }).compile();
      const gw = m.get(AiGatewayService);

      await expect(gw.embedBatch('user-001', ['text'])).rejects.toThrow(
        'OpenAI provider not available for batch embeddings',
      );
    });
  });

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

  describe('completeEnsemble()', () => {
    it('calls all listed providers in parallel and returns successful results', async () => {
      primaryProvider.complete.mockResolvedValue(
        makeResult({ provider: 'openai' }),
      );
      secondaryProvider.complete.mockResolvedValue(
        makeResult({ provider: 'gemini' }),
      );

      const results = await gateway.completeEnsemble('user1', BASE_OPTIONS, [
        'openai',
        'gemini',
      ]);

      expect(results).toHaveLength(2);
      expect(primaryProvider.complete).toHaveBeenCalledTimes(1);
      expect(secondaryProvider.complete).toHaveBeenCalledTimes(1);
    });

    it('skips providers that are not registered', async () => {
      primaryProvider.complete.mockResolvedValue(makeResult());

      const results = await gateway.completeEnsemble('user1', BASE_OPTIONS, [
        'openai',
        'no-such-provider',
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].provider).toBe('openai');
    });

    it('skips providers with isAvailable=false', async () => {
      const unavailable = makeProvider('openai', false);
      const available = makeProvider('gemini', true);
      available.complete.mockResolvedValue(makeResult({ provider: 'gemini' }));

      const m = await Test.createTestingModule({
        providers: [
          AiGatewayService,
          { provide: LLM_PROVIDERS, useValue: [unavailable, available] },
          { provide: DataSanitizer, useValue: sanitizer },
          { provide: TokenBudgetService, useValue: budget },
          { provide: AiMetricsService, useValue: metrics },
        ],
      }).compile();
      const gw = m.get(AiGatewayService);

      const results = await gw.completeEnsemble('user1', BASE_OPTIONS, [
        'openai',
        'gemini',
      ]);

      expect(unavailable.complete).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].provider).toBe('gemini');
    });

    it('drops failed provider results, keeps successes', async () => {
      primaryProvider.complete.mockRejectedValue(new Error('openai down'));
      secondaryProvider.complete.mockResolvedValue(
        makeResult({ provider: 'gemini' }),
      );

      const results = await gateway.completeEnsemble('user1', BASE_OPTIONS, [
        'openai',
        'gemini',
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].provider).toBe('gemini');
    });

    it('returns empty array when all providers fail (does NOT throw)', async () => {
      primaryProvider.complete.mockRejectedValue(new Error('a'));
      secondaryProvider.complete.mockRejectedValue(new Error('b'));

      const results = await gateway.completeEnsemble('user1', BASE_OPTIONS, [
        'openai',
        'gemini',
      ]);

      expect(results).toEqual([]);
    });

    it('returns empty array when no providers are eligible', async () => {
      const results = await gateway.completeEnsemble('user1', BASE_OPTIONS, [
        'no-such-provider',
      ]);
      expect(results).toEqual([]);
    });

    it('sanitizes messages once for all providers (PII stripped)', async () => {
      sanitizer.sanitize.mockReturnValue('[SANITIZED]');
      primaryProvider.complete.mockResolvedValue(makeResult());
      secondaryProvider.complete.mockResolvedValue(makeResult());

      await gateway.completeEnsemble('user1', BASE_OPTIONS, [
        'openai',
        'gemini',
      ]);

      const opts1 = primaryProvider.complete.mock.calls[0][0];
      const opts2 = secondaryProvider.complete.mock.calls[0][0];
      expect(opts1.messages[0].content).toBe('[SANITIZED]');
      expect(opts2.messages[0].content).toBe('[SANITIZED]');
    });

    it('throws when budget cannot cover all providers', async () => {
      budget.canConsume.mockResolvedValue(false);

      await expect(
        gateway.completeEnsemble('user1', BASE_OPTIONS, ['openai', 'gemini']),
      ).rejects.toThrow('Daily token budget exceeded');
    });

    it('consumes tokens for each successful provider', async () => {
      primaryProvider.complete.mockResolvedValue(
        makeResult({ tokensIn: 100, tokensOut: 50 }),
      );
      secondaryProvider.complete.mockResolvedValue(
        makeResult({ tokensIn: 80, tokensOut: 40 }),
      );

      await gateway.completeEnsemble('user1', BASE_OPTIONS, [
        'openai',
        'gemini',
      ]);

      expect(budget.consume).toHaveBeenCalledWith('user1', 150);
      expect(budget.consume).toHaveBeenCalledWith('user1', 120);
    });

    it('skips providers with open circuit breaker', async () => {
      primaryProvider.complete.mockRejectedValue(new Error('fail'));
      secondaryProvider.complete.mockResolvedValue(
        makeResult({ provider: 'gemini' }),
      );
      for (let i = 0; i < 5; i++) {
        await gateway.complete('user1', BASE_OPTIONS);
      }

      primaryProvider.complete.mockClear();
      secondaryProvider.complete.mockClear();
      secondaryProvider.complete.mockResolvedValue(
        makeResult({ provider: 'gemini' }),
      );

      const results = await gateway.completeEnsemble('user1', BASE_OPTIONS, [
        'openai',
        'gemini',
      ]);

      expect(primaryProvider.complete).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].provider).toBe('gemini');
    });
  });

  describe('locdo_router provider integration', () => {
    let lcdoProvider: jest.Mocked<ILlmProvider>;
    let openaiProvider: jest.Mocked<ILlmProvider>;
    let gatewayWithLocdo: AiGatewayService;

    beforeEach(async () => {
      lcdoProvider = makeProvider('locdo_router');
      openaiProvider = makeProvider('openai');

      const m = await Test.createTestingModule({
        providers: [
          AiGatewayService,
          {
            provide: LLM_PROVIDERS,
            useValue: [lcdoProvider, openaiProvider],
          },
          { provide: DataSanitizer, useValue: sanitizer },
          { provide: TokenBudgetService, useValue: budget },
          { provide: AiMetricsService, useValue: metrics },
        ],
      }).compile();

      gatewayWithLocdo = m.get(AiGatewayService);
    });

    it('uses locdo_router as the first (primary) provider', async () => {
      lcdoProvider.complete.mockResolvedValue(
        makeResult({ provider: 'locdo_router', model: 'claude-sonnet-4-6' }),
      );

      const result = await gatewayWithLocdo.complete('user1', BASE_OPTIONS);

      expect(result.provider).toBe('locdo_router');
      expect(lcdoProvider.complete).toHaveBeenCalledTimes(1);
      expect(openaiProvider.complete).not.toHaveBeenCalled();
    });

    it('falls back to openai when locdo_router fails', async () => {
      lcdoProvider.complete.mockRejectedValue(new Error('router down'));
      openaiProvider.complete.mockResolvedValue(
        makeResult({ provider: 'openai' }),
      );

      const result = await gatewayWithLocdo.complete('user1', BASE_OPTIONS);

      expect(result.provider).toBe('openai');
      expect(lcdoProvider.complete).toHaveBeenCalledTimes(1);
      expect(openaiProvider.complete).toHaveBeenCalledTimes(1);
    });

    it('throws when both locdo_router and openai fail', async () => {
      lcdoProvider.complete.mockRejectedValue(new Error('router down'));
      openaiProvider.complete.mockRejectedValue(new Error('openai down'));

      await expect(
        gatewayWithLocdo.complete('user1', BASE_OPTIONS),
      ).rejects.toThrow('All LLM providers failed');
    });

    it('skips locdo_router when it is unavailable and uses openai', async () => {
      const unavailableLocdo = makeProvider('locdo_router', false);
      openaiProvider.complete.mockResolvedValue(
        makeResult({ provider: 'openai' }),
      );

      const m = await Test.createTestingModule({
        providers: [
          AiGatewayService,
          {
            provide: LLM_PROVIDERS,
            useValue: [unavailableLocdo, openaiProvider],
          },
          { provide: DataSanitizer, useValue: sanitizer },
          { provide: TokenBudgetService, useValue: budget },
          { provide: AiMetricsService, useValue: metrics },
        ],
      }).compile();

      const gw = m.get(AiGatewayService);
      const result = await gw.complete('user1', BASE_OPTIONS);

      expect(unavailableLocdo.complete).not.toHaveBeenCalled();
      expect(result.provider).toBe('openai');
    });

    it('can retrieve locdo_router via getProvider()', () => {
      const provider = gatewayWithLocdo.getProvider('locdo_router');
      expect(provider).toBe(lcdoProvider);
    });

    it('opens circuit for locdo_router after 5 consecutive failures', async () => {
      lcdoProvider.complete.mockRejectedValue(new Error('router down'));
      openaiProvider.complete.mockResolvedValue(makeResult());

      for (let i = 0; i < 5; i++) {
        await gatewayWithLocdo.complete('user1', BASE_OPTIONS);
      }

      lcdoProvider.complete.mockClear();
      openaiProvider.complete.mockClear();
      openaiProvider.complete.mockResolvedValue(makeResult());

      await gatewayWithLocdo.complete('user1', BASE_OPTIONS);

      expect(lcdoProvider.complete).not.toHaveBeenCalled();
      expect(openaiProvider.complete).toHaveBeenCalledTimes(1);
    });

    it('applies PII sanitization to messages before calling locdo_router', async () => {
      sanitizer.sanitize.mockReturnValue('[REDACTED]');
      lcdoProvider.complete.mockResolvedValue(makeResult());

      await gatewayWithLocdo.complete('user1', {
        messages: [{ role: 'user', content: 'user@example.com' }],
      });

      expect(sanitizer.sanitize).toHaveBeenCalledWith('user@example.com');
      const calledWith = lcdoProvider.complete.mock.calls[0][0];
      expect(calledWith.messages[0].content).toBe('[REDACTED]');
    });
  });
});
