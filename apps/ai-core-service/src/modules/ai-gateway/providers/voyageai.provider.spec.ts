import { Test, TestingModule } from '@nestjs/testing';
import { APP_CONFIG } from '@libs/config';
import { VoyageAiProvider } from './voyageai.provider';

function makeConfig(overrides: Record<string, unknown> = {}) {
  return { voyageAiApiKey: 'test-voyage-key', ...overrides };
}

async function buildProvider(configOverrides: Record<string, unknown> = {}) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      VoyageAiProvider,
      { provide: APP_CONFIG, useValue: makeConfig(configOverrides) },
    ],
  }).compile();

  return module.get(VoyageAiProvider);
}

function mockFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

const HAPPY_RESPONSE = {
  data: [
    { embedding: [0.1, 0.2, 0.3], index: 0 },
    { embedding: [0.4, 0.5, 0.6], index: 1 },
  ],
  usage: { total_tokens: 20 },
  model: 'voyage-3',
};

describe('VoyageAiProvider', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('isAvailable', () => {
    it('returns true when voyageAiApiKey is set', async () => {
      const provider = await buildProvider();
      expect(provider.isAvailable).toBe(true);
    });

    it('returns false when voyageAiApiKey is absent', async () => {
      const provider = await buildProvider({ voyageAiApiKey: undefined });
      expect(provider.isAvailable).toBe(false);
    });

    it('returns false when voyageAiApiKey is empty string', async () => {
      const provider = await buildProvider({ voyageAiApiKey: '' });
      expect(provider.isAvailable).toBe(false);
    });
  });

  describe('complete()', () => {
    it('rejects — Voyage AI does not support chat completions', async () => {
      const provider = await buildProvider();
      await expect(provider.complete()).rejects.toThrow(
        'Voyage AI does not support chat completions.',
      );
    });
  });

  describe('completeStream()', () => {
    it('rejects — Voyage AI does not support chat completions', async () => {
      const provider = await buildProvider();
      await expect(provider.completeStream()).rejects.toThrow(
        'Voyage AI does not support chat completions.',
      );
    });
  });

  describe('embedBatch()', () => {
    it('returns empty array without calling the API when given empty input', async () => {
      const provider = await buildProvider();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const result = await provider.embedBatch([]);

      expect(result).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('happy path: calls Voyage API and returns ordered results', async () => {
      const provider = await buildProvider();
      global.fetch = mockFetch(
        200,
        HAPPY_RESPONSE,
      ) as unknown as typeof global.fetch;

      const results = await provider.embedBatch(['hello', 'world']);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        embedding: [0.1, 0.2, 0.3],
        tokensUsed: 10,
        model: 'voyage-3',
        provider: 'voyageai',
      });
      expect(results[1]).toMatchObject({
        embedding: [0.4, 0.5, 0.6],
        tokensUsed: 10,
        model: 'voyage-3',
        provider: 'voyageai',
      });
    });

    it('sorts results by index even when API returns them out of order', async () => {
      const provider = await buildProvider();
      const outOfOrderResponse = {
        data: [
          { embedding: [0.4, 0.5, 0.6], index: 1 },
          { embedding: [0.1, 0.2, 0.3], index: 0 },
        ],
        usage: { total_tokens: 20 },
        model: 'voyage-3',
      };
      global.fetch = mockFetch(
        200,
        outOfOrderResponse,
      ) as unknown as typeof global.fetch;

      const results = await provider.embedBatch(['first', 'second']);

      expect(results[0].embedding).toEqual([0.1, 0.2, 0.3]);
      expect(results[1].embedding).toEqual([0.4, 0.5, 0.6]);
    });

    it('uses the provided model override', async () => {
      const provider = await buildProvider();
      const fetchMock = mockFetch(200, {
        ...HAPPY_RESPONSE,
        model: 'voyage-3-lite',
      });
      global.fetch = fetchMock as unknown as typeof global.fetch;

      await provider.embedBatch(['hello'], 'voyage-3-lite');

      const [, callInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callInit.body as string) as { model: string };
      expect(body.model).toBe('voyage-3-lite');
    });
  });

  describe('embed()', () => {
    it('returns a single result for a single text', async () => {
      const singleResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
        usage: { total_tokens: 5 },
        model: 'voyage-3',
      };
      const provider = await buildProvider();
      global.fetch = mockFetch(
        200,
        singleResponse,
      ) as unknown as typeof global.fetch;

      const result = await provider.embed('hello');

      expect(result).toMatchObject({
        embedding: [0.1, 0.2, 0.3],
        tokensUsed: 5,
        model: 'voyage-3',
        provider: 'voyageai',
      });
    });
  });

  describe('HTTP error handling', () => {
    it('throws on non-OK response', async () => {
      const provider = await buildProvider();
      global.fetch = mockFetch(429, {
        error: 'rate limited',
      }) as unknown as typeof global.fetch;

      await expect(provider.embed('hello')).rejects.toThrow(
        'Voyage AI API error 429',
      );
    });

    it('throws on 500 error', async () => {
      const provider = await buildProvider();
      global.fetch = mockFetch(500, {
        error: 'internal server error',
      }) as unknown as typeof global.fetch;

      await expect(provider.embedBatch(['hello'])).rejects.toThrow(
        'Voyage AI API error 500',
      );
    });
  });
});
