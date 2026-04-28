import { Test, TestingModule } from '@nestjs/testing';
import { APP_CONFIG } from '@libs/config';
import { LocDoRouterProvider } from './locdo-router.provider';

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    lcdoRouterUrl: 'https://ai-router.locdo.tech',
    lcdoRouterKey: 'sk-test-key',
    lcdoRouterModel: 'claude-sonnet-4-6',
    ...overrides,
  };
}

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    messages: [
      { role: 'system' as const, content: 'You are a helpful assistant.' },
      { role: 'user' as const, content: 'Hello!' },
    ],
    maxTokens: 256,
    temperature: 0.7,
    ...overrides,
  };
}

function makeChatResponse(content: string, tokensIn = 10, tokensOut = 20) {
  return {
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: tokensIn, completion_tokens: tokensOut },
  };
}

async function buildProvider(configOverrides: Record<string, unknown> = {}) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LocDoRouterProvider,
      { provide: APP_CONFIG, useValue: makeConfig(configOverrides) },
    ],
  }).compile();

  return module.get(LocDoRouterProvider);
}

describe('LocDoRouterProvider', () => {
  describe('name', () => {
    it('has name "locdo_router"', async () => {
      const provider = await buildProvider();
      expect(provider.name).toBe('locdo_router');
    });
  });

  describe('isAvailable', () => {
    it('returns true when both url and key are set', async () => {
      const provider = await buildProvider();
      expect(provider.isAvailable).toBe(true);
    });

    it('returns false when lcdoRouterUrl is missing', async () => {
      const provider = await buildProvider({ lcdoRouterUrl: undefined });
      expect(provider.isAvailable).toBe(false);
    });

    it('returns false when lcdoRouterKey is missing', async () => {
      const provider = await buildProvider({ lcdoRouterKey: undefined });
      expect(provider.isAvailable).toBe(false);
    });

    it('returns false when both url and key are missing', async () => {
      const provider = await buildProvider({
        lcdoRouterUrl: undefined,
        lcdoRouterKey: undefined,
      });
      expect(provider.isAvailable).toBe(false);
    });

    it('returns false when lcdoRouterUrl is not a valid URL', async () => {
      const provider = await buildProvider({ lcdoRouterUrl: 'enabled' });
      expect(provider.isAvailable).toBe(false);
    });

    it('returns false when lcdoRouterUrl uses a non-http protocol', async () => {
      const provider = await buildProvider({
        lcdoRouterUrl: 'ftp://ai-router.locdo.tech',
      });
      expect(provider.isAvailable).toBe(false);
    });
  });

  describe('complete()', () => {
    it('returns content, token counts, provider name, and latency', async () => {
      const provider = await buildProvider();

      const mockCreate = jest
        .fn()
        .mockResolvedValue(makeChatResponse('Hello back!', 15, 25));
      (provider as unknown as Record<string, unknown>).client = {
        chat: { completions: { create: mockCreate } },
      };

      const result = await provider.complete(makeOptions());

      expect(result.content).toBe('Hello back!');
      expect(result.tokensIn).toBe(15);
      expect(result.tokensOut).toBe(25);
      expect(result.provider).toBe('locdo_router');
      expect(result.model).toBe('claude-sonnet-4-6');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('uses options.model when provided instead of default', async () => {
      const provider = await buildProvider();

      const mockCreate = jest
        .fn()
        .mockResolvedValue(makeChatResponse('ok', 5, 5));
      (provider as unknown as Record<string, unknown>).client = {
        chat: { completions: { create: mockCreate } },
      };

      await provider.complete(makeOptions({ model: 'claude-haiku-4.5' }));

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-haiku-4.5' }),
      );
    });

    it('falls back to lcdoRouterModel config when options.model is not set', async () => {
      const provider = await buildProvider({
        lcdoRouterModel: 'claude-opus-4.6',
      });

      const mockCreate = jest.fn().mockResolvedValue(makeChatResponse('ok'));
      (provider as unknown as Record<string, unknown>).client = {
        chat: { completions: { create: mockCreate } },
      };

      await provider.complete(makeOptions());

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-opus-4.6' }),
      );
    });

    it('defaults to "claude-sonnet-4-6" when lcdoRouterModel is not set', async () => {
      const provider = await buildProvider({ lcdoRouterModel: undefined });

      const mockCreate = jest.fn().mockResolvedValue(makeChatResponse('ok'));
      (provider as unknown as Record<string, unknown>).client = {
        chat: { completions: { create: mockCreate } },
      };

      await provider.complete(makeOptions());

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      );
    });

    it('passes maxTokens and temperature to the OpenAI client', async () => {
      const provider = await buildProvider();

      const mockCreate = jest.fn().mockResolvedValue(makeChatResponse('ok'));
      (provider as unknown as Record<string, unknown>).client = {
        chat: { completions: { create: mockCreate } },
      };

      await provider.complete(
        makeOptions({ maxTokens: 512, temperature: 0.3 }),
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 512, temperature: 0.3 }),
      );
    });

    it('returns empty content when choices array is empty', async () => {
      const provider = await buildProvider();

      const mockCreate = jest.fn().mockResolvedValue({
        choices: [],
        usage: { prompt_tokens: 5, completion_tokens: 0 },
      });
      (provider as unknown as Record<string, unknown>).client = {
        chat: { completions: { create: mockCreate } },
      };

      const result = await provider.complete(makeOptions());
      expect(result.content).toBe('');
    });

    it('throws a wrapped error when the API call fails', async () => {
      const provider = await buildProvider();

      const mockCreate = jest
        .fn()
        .mockRejectedValue(new Error('network error'));
      (provider as unknown as Record<string, unknown>).client = {
        chat: { completions: { create: mockCreate } },
      };

      await expect(provider.complete(makeOptions())).rejects.toThrow(
        'LocDo Router API call failed: network error',
      );
    });
  });

  describe('completeStream()', () => {
    it('calls onChunk for each delta and returns accumulated content', async () => {
      const provider = await buildProvider();

      function* fakeStream() {
        yield {
          choices: [{ delta: { content: 'Hello' }, finish_reason: null }],
          usage: null,
        };
        yield {
          choices: [{ delta: { content: ' world' }, finish_reason: null }],
          usage: null,
        };
        yield {
          choices: [{ delta: { content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      }

      const mockCreate = jest.fn().mockResolvedValue(fakeStream());
      (provider as unknown as Record<string, unknown>).client = {
        chat: { completions: { create: mockCreate } },
      };

      const chunks: string[] = [];
      const onChunk = jest.fn((chunk: { content: string }) =>
        chunks.push(chunk.content),
      );

      const result = await provider.completeStream(makeOptions(), onChunk);

      expect(result.content).toBe('Hello world');
      expect(result.provider).toBe('locdo_router');
      expect(result.tokensIn).toBe(10);
      expect(result.tokensOut).toBe(5);
      expect(chunks).toContain('Hello');
      expect(chunks).toContain(' world');
    });

    it('throws a wrapped error when streaming fails', async () => {
      const provider = await buildProvider();

      const mockCreate = jest.fn().mockRejectedValue(new Error('stream error'));
      (provider as unknown as Record<string, unknown>).client = {
        chat: { completions: { create: mockCreate } },
      };

      await expect(
        provider.completeStream(makeOptions(), jest.fn()),
      ).rejects.toThrow('LocDo Router streaming API call failed: stream error');
    });

    it('emits a final isFinal chunk when stream finishes', async () => {
      const provider = await buildProvider();

      function* fakeStream() {
        yield {
          choices: [{ delta: { content: 'hi' }, finish_reason: null }],
          usage: null,
        };
        yield {
          choices: [{ delta: { content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        };
      }

      const mockCreate = jest.fn().mockResolvedValue(fakeStream());
      (provider as unknown as Record<string, unknown>).client = {
        chat: { completions: { create: mockCreate } },
      };

      const receivedChunks: Array<{ content: string; isFinal: boolean }> = [];
      await provider.completeStream(makeOptions(), (chunk) =>
        receivedChunks.push(chunk),
      );

      const finalChunk = receivedChunks.find((c) => c.isFinal);
      expect(finalChunk).toBeDefined();
      expect(finalChunk?.content).toBe('');
    });
  });

  describe('embed()', () => {
    it('throws because LocDo Router does not support embeddings', async () => {
      const provider = await buildProvider();

      await expect(provider.embed('some text')).rejects.toThrow(
        'LocDo Router does not support embeddings',
      );
    });
  });

  describe('baseURL construction', () => {
    it('strips trailing slash from lcdoRouterUrl before appending /v2', async () => {
      const provider = await buildProvider({
        lcdoRouterUrl: 'https://ai-router.locdo.tech/',
      });

      const mockCreate = jest.fn().mockResolvedValue(makeChatResponse('ok'));

      (provider as unknown as Record<string, unknown>).client = {
        chat: { completions: { create: mockCreate } },
      };

      await expect(provider.complete(makeOptions())).resolves.toBeDefined();
    });
  });
});
