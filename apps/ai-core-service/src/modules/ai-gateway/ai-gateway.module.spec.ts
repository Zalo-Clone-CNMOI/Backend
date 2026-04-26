/**
 * @file ai-gateway.module.spec.ts
 *
 * Smoke tests for AiGatewayModule wiring.
 *
 * Verifies:
 *  - All four providers compile and are injectable with stub config
 *  - LocDoRouterProvider is the first provider in LLM_PROVIDERS array
 *  - All providers implement the ILlmProvider interface shape
 *  - toAiProviderType helper correctly maps 'locdo_router' (shared from @libs/contracts)
 *
 * Note: We wire providers explicitly (not via imports: [AiGatewayModule])
 * because AiGatewayModule depends on ConfigModule which requires full NestJS
 * bootstrap. This approach mirrors the pattern used in all other spec files
 * in this service and is the idiomatic NestJS testing convention.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { APP_CONFIG } from '@libs/config';
import { toAiProviderType } from '@libs/contracts';
import { LocDoRouterProvider } from './providers/locdo-router.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { LLM_PROVIDERS, ILlmProvider } from './interfaces';

// No provider keys set — verifies wiring without making real API calls
const STUB_CONFIG = {
  lcdoRouterUrl: undefined,
  lcdoRouterKey: undefined,
  lcdoRouterModel: undefined,
  openaiApiKey: undefined,
  geminiApiKey: undefined,
  anthropicApiKey: undefined,
  aiDefaultModel: 'gpt-4o-mini',
  aiEmbeddingModel: 'text-embedding-3-small',
  aiDailyTokenBudget: 1_000_000,
  aiEnablePiiSanitization: true,
};

// Config with a valid LocDo key — to verify isAvailable flips to true
const STUB_CONFIG_WITH_LOCDO = {
  ...STUB_CONFIG,
  lcdoRouterUrl: 'https://ai-router.locdo.tech',
  lcdoRouterKey: 'sk-test-key',
  lcdoRouterModel: 'claude-sonnet-4-6',
};

async function buildModule(config: object): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      LocDoRouterProvider,
      OpenAiProvider,
      GeminiProvider,
      AnthropicProvider,
      {
        provide: LLM_PROVIDERS,
        useFactory: (
          locdo: LocDoRouterProvider,
          openai: OpenAiProvider,
          gemini: GeminiProvider,
          anthropic: AnthropicProvider,
        ) => [locdo, openai, gemini, anthropic],
        inject: [
          LocDoRouterProvider,
          OpenAiProvider,
          GeminiProvider,
          AnthropicProvider,
        ],
      },
      { provide: APP_CONFIG, useValue: config },
    ],
  }).compile();
}

describe('AiGatewayModule (provider wiring)', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await buildModule(STUB_CONFIG);
  });

  afterEach(async () => {
    await module.close();
  });

  it('compiles without errors', () => {
    expect(module).toBeDefined();
  });

  it('provides LocDoRouterProvider with name "locdo_router"', () => {
    const p = module.get(LocDoRouterProvider);
    expect(p).toBeInstanceOf(LocDoRouterProvider);
    expect(p.name).toBe('locdo_router');
  });

  it('provides OpenAiProvider with name "openai"', () => {
    const p = module.get(OpenAiProvider);
    expect(p).toBeInstanceOf(OpenAiProvider);
    expect(p.name).toBe('openai');
  });

  it('provides GeminiProvider with name "gemini"', () => {
    const p = module.get(GeminiProvider);
    expect(p).toBeInstanceOf(GeminiProvider);
    expect(p.name).toBe('gemini');
  });

  it('provides AnthropicProvider with name "anthropic"', () => {
    const p = module.get(AnthropicProvider);
    expect(p).toBeInstanceOf(AnthropicProvider);
    expect(p.name).toBe('anthropic');
  });

  describe('LLM_PROVIDERS array order and shape', () => {
    let providers: ILlmProvider[];

    beforeEach(() => {
      providers = module.get<ILlmProvider[]>(LLM_PROVIDERS);
    });

    it('contains exactly 4 providers', () => {
      expect(providers).toHaveLength(4);
    });

    it('has locdo_router first (primary)', () => {
      expect(providers[0].name).toBe('locdo_router');
    });

    it('has openai second', () => {
      expect(providers[1].name).toBe('openai');
    });

    it('has gemini third', () => {
      expect(providers[2].name).toBe('gemini');
    });

    it('has anthropic fourth', () => {
      expect(providers[3].name).toBe('anthropic');
    });

    it('each provider implements the ILlmProvider interface shape', () => {
      for (const p of providers) {
        expect(typeof p.name).toBe('string');
        expect(typeof p.isAvailable).toBe('boolean');
        expect(typeof p.complete).toBe('function');
        expect(typeof p.completeStream).toBe('function');
        expect(typeof p.embed).toBe('function');
      }
    });

    it('all providers report isAvailable=false when no keys are set', () => {
      for (const p of providers) {
        expect(p.isAvailable).toBe(false);
      }
    });
  });

  describe('LocDoRouterProvider.isAvailable with valid config', () => {
    it('reports isAvailable=true when url and key are set', async () => {
      const m = await buildModule(STUB_CONFIG_WITH_LOCDO);
      const p = m.get(LocDoRouterProvider);
      expect(p.isAvailable).toBe(true);
      await m.close();
    });
  });
});

// ── toAiProviderType helper ──────────────────────────────────────────────────

describe('toAiProviderType (from @libs/contracts)', () => {
  it.each([
    ['openai', 'openai'],
    ['gemini', 'gemini'],
    ['anthropic', 'anthropic'],
    ['locdo_router', 'locdo_router'],
  ] as const)('maps "%s" → "%s"', (input, expected) => {
    expect(toAiProviderType(input)).toBe(expected);
  });

  it('falls back to "openai" for unknown provider names', () => {
    expect(toAiProviderType('unknown-provider')).toBe('openai');
    expect(toAiProviderType('')).toBe('openai');
    expect(toAiProviderType('OPENAI')).toBe('openai'); // case-sensitive
  });
});
