import { Test, TestingModule } from '@nestjs/testing';
import { APP_CONFIG } from '@libs/config';
import { OpenAiProvider } from './openai.provider';

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    openaiApiKey: 'test-key',
    aiEmbeddingModel: 'text-embedding-3-small',
    ...overrides,
  };
}

async function buildProvider(configOverrides: Record<string, unknown> = {}) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OpenAiProvider,
      { provide: APP_CONFIG, useValue: makeConfig(configOverrides) },
    ],
  }).compile();

  return module.get(OpenAiProvider);
}

function injectMockClient(
  provider: OpenAiProvider,
  mockEmbeddingsCreate: jest.Mock,
) {
  (provider as unknown as Record<string, unknown>).client = {
    embeddings: { create: mockEmbeddingsCreate },
    chat: { completions: { create: jest.fn() } },
  };
}

describe('OpenAiProvider.embedBatch', () => {
  describe('empty input', () => {
    it('returns empty array without calling the API', async () => {
      const provider = await buildProvider();
      const mockCreate = jest.fn();
      injectMockClient(provider, mockCreate);

      const result = await provider.embedBatch([]);

      expect(result).toEqual([]);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('calls OpenAI with array input and returns ordered results', async () => {
      const provider = await buildProvider();
      const mockCreate = jest.fn().mockResolvedValue({
        data: [
          { embedding: [0.1, 0.2, 0.3], index: 0 },
          { embedding: [0.4, 0.5, 0.6], index: 1 },
        ],
        usage: { total_tokens: 20 },
      });
      injectMockClient(provider, mockCreate);

      const results = await provider.embedBatch(['hello', 'world']);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['hello', 'world'],
      });
      expect(results).toHaveLength(2);
      expect(results[0].embedding).toEqual([0.1, 0.2, 0.3]);
      expect(results[1].embedding).toEqual([0.4, 0.5, 0.6]);
    });

    it('returns provider name "openai" for each result', async () => {
      const provider = await buildProvider();
      const mockCreate = jest.fn().mockResolvedValue({
        data: [{ embedding: [1, 2], index: 0 }],
        usage: { total_tokens: 10 },
      });
      injectMockClient(provider, mockCreate);

      const results = await provider.embedBatch(['text']);

      expect(results[0].provider).toBe('openai');
    });

    it('returns the resolved embedding model on each result', async () => {
      const provider = await buildProvider({
        aiEmbeddingModel: 'text-embedding-3-large',
      });
      const mockCreate = jest.fn().mockResolvedValue({
        data: [{ embedding: [0.9], index: 0 }],
        usage: { total_tokens: 5 },
      });
      injectMockClient(provider, mockCreate);

      const results = await provider.embedBatch(
        ['x'],
        'text-embedding-3-large',
      );

      expect(results[0].model).toBe('text-embedding-3-large');
    });
  });

  describe('token distribution', () => {
    it('distributes total tokens evenly across all results', async () => {
      const provider = await buildProvider();
      const mockCreate = jest.fn().mockResolvedValue({
        data: [
          { embedding: [1], index: 0 },
          { embedding: [2], index: 1 },
          { embedding: [3], index: 2 },
        ],
        usage: { total_tokens: 30 },
      });
      injectMockClient(provider, mockCreate);

      const results = await provider.embedBatch(['a', 'b', 'c']);

      const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
      expect(totalTokens).toBe(30);
    });

    it('assigns remainder tokens to the last chunk for non-divisible totals', async () => {
      const provider = await buildProvider();
      const mockCreate = jest.fn().mockResolvedValue({
        data: [
          { embedding: [1], index: 0 },
          { embedding: [2], index: 1 },
          { embedding: [3], index: 2 },
        ],
        usage: { total_tokens: 10 }, // 10 / 3 = 3 remainder 1
      });
      injectMockClient(provider, mockCreate);

      const results = await provider.embedBatch(['a', 'b', 'c']);

      const sum = results.reduce((s, r) => s + r.tokensUsed, 0);
      expect(sum).toBe(10); // no tokens lost
      expect(results[2].tokensUsed).toBe(results[0].tokensUsed + 1); // remainder on last
    });

    it('handles missing usage gracefully (defaults to 0 total tokens)', async () => {
      const provider = await buildProvider();
      const mockCreate = jest.fn().mockResolvedValue({
        data: [{ embedding: [0.5], index: 0 }],
        usage: undefined,
      });
      injectMockClient(provider, mockCreate);

      const results = await provider.embedBatch(['text']);

      expect(results[0].tokensUsed).toBe(0);
    });
  });

  describe('model resolution', () => {
    it('uses the model argument when provided', async () => {
      const provider = await buildProvider({ aiEmbeddingModel: undefined });
      const mockCreate = jest.fn().mockResolvedValue({
        data: [{ embedding: [0.1], index: 0 }],
        usage: { total_tokens: 5 },
      });
      injectMockClient(provider, mockCreate);

      await provider.embedBatch(['text'], 'text-embedding-ada-002');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'text-embedding-ada-002' }),
      );
    });

    it('falls back to config.aiEmbeddingModel when no model argument given', async () => {
      const provider = await buildProvider({
        aiEmbeddingModel: 'text-embedding-3-large',
      });
      const mockCreate = jest.fn().mockResolvedValue({
        data: [{ embedding: [0.1], index: 0 }],
        usage: { total_tokens: 5 },
      });
      injectMockClient(provider, mockCreate);

      await provider.embedBatch(['text']);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'text-embedding-3-large' }),
      );
    });

    it('falls back to "text-embedding-3-small" when neither argument nor config are set', async () => {
      const provider = await buildProvider({ aiEmbeddingModel: undefined });
      const mockCreate = jest.fn().mockResolvedValue({
        data: [{ embedding: [0.1], index: 0 }],
        usage: { total_tokens: 5 },
      });
      injectMockClient(provider, mockCreate);

      await provider.embedBatch(['text']);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'text-embedding-3-small' }),
      );
    });
  });

  describe('error handling', () => {
    it('throws a wrapped error when the OpenAI API fails', async () => {
      const provider = await buildProvider();
      const mockCreate = jest
        .fn()
        .mockRejectedValue(new Error('rate limit exceeded'));
      injectMockClient(provider, mockCreate);

      await expect(provider.embedBatch(['text'])).rejects.toThrow(
        'OpenAI batch embedding API call failed: rate limit exceeded',
      );
    });

    it('wraps non-Error rejections as unknown error', async () => {
      const provider = await buildProvider();
      const mockCreate = jest.fn().mockRejectedValue('string error');
      injectMockClient(provider, mockCreate);

      await expect(provider.embedBatch(['text'])).rejects.toThrow(
        'OpenAI batch embedding API call failed: Unknown error',
      );
    });
  });
});
