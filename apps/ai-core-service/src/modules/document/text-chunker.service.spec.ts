import { TextChunkerService } from './text-chunker.service';

describe('TextChunkerService', () => {
  let service: TextChunkerService;

  beforeEach(() => {
    service = new TextChunkerService();
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty array for empty input', async () => {
      const result = await service.chunk('', { size: 100, overlap: 20 });
      expect(result).toEqual([]);
    });

    it('returns empty array for whitespace-only input', async () => {
      const result = await service.chunk('   \n\t  ', {
        size: 100,
        overlap: 20,
      });
      expect(result).toEqual([]);
    });

    it('throws when overlap >= size', async () => {
      await expect(
        service.chunk('hello world', { size: 50, overlap: 50 }),
      ).rejects.toThrow(/overlap.*less than size/);
      await expect(
        service.chunk('hello world', { size: 50, overlap: 100 }),
      ).rejects.toThrow(/overlap.*less than size/);
    });

    it('throws when size <= 0', async () => {
      await expect(
        service.chunk('hello world', { size: 0, overlap: 0 }),
      ).rejects.toThrow(/size must be positive/);
      await expect(
        service.chunk('hello world', { size: -1, overlap: 0 }),
      ).rejects.toThrow(/size must be positive/);
    });

    it('throws when overlap < 0', async () => {
      await expect(
        service.chunk('hello world', { size: 50, overlap: -1 }),
      ).rejects.toThrow(/overlap must be non-negative/);
    });

    it('returns single chunk for short text', async () => {
      const result = await service.chunk('Hello world', {
        size: 100,
        overlap: 10,
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('Hello world');
    });
  });

  // ── Token-based chunking ────────────────────────────────────────────

  describe('token-based chunking', () => {
    // ~600 tokens of English text
    const longEnglish = Array(200)
      .fill('The quick brown fox jumps over the lazy dog.')
      .join(' ');

    it('splits long text into multiple chunks', async () => {
      const chunks = await service.chunk(longEnglish, {
        size: 100,
        overlap: 20,
      });
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('each chunk approximately respects size limit (in tokens)', async () => {
      const chunks = await service.chunk(longEnglish, {
        size: 100,
        overlap: 20,
      });
      for (const chunk of chunks) {
        const count = await service.countTokens(chunk);
        // Allow small tolerance because trim() can drop a token boundary
        expect(count).toBeLessThanOrEqual(110);
      }
    });

    it('produces real overlap (combined length > full text length proves shared content)', async () => {
      const size = 80;
      const overlap = 20;
      const chunks = await service.chunk(longEnglish, { size, overlap });
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // Sliding-window contract: sum of chunk token counts > total text token count
      // because the overlap region is counted twice. If chunks were disjoint
      // (no overlap), sum would equal text token count.
      const totalTextTokens = await service.countTokens(longEnglish);
      const chunkTokenCounts = await Promise.all(
        chunks.map((c) => service.countTokens(c)),
      );
      const summedChunkTokens = chunkTokenCounts.reduce((a, b) => a + b, 0);
      expect(summedChunkTokens).toBeGreaterThan(totalTextTokens);

      // First chunk should be roughly `size` tokens
      const firstChunkTokens = chunkTokenCounts[0];
      expect(firstChunkTokens).toBeGreaterThanOrEqual(size - overlap);
      expect(firstChunkTokens).toBeLessThanOrEqual(size + 5);
    });
  });

  // ── Vietnamese support ──────────────────────────────────────────────

  describe('Vietnamese text', () => {
    const longVietnamese = Array(100)
      .fill(
        'Cửa hàng số 5 ở Hà Nội có khuyến mãi đặc biệt cho khách hàng thân thiết.',
      )
      .join(' ');

    it('chunks Vietnamese text correctly (with diacritics)', async () => {
      const chunks = await service.chunk(longVietnamese, {
        size: 100,
        overlap: 20,
      });
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        // Output should preserve Vietnamese characters readably
        expect(chunk).toMatch(
          /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i,
        );
      }
    });

    it('Vietnamese text produces more tokens than equivalent word count suggests', async () => {
      const text = 'Cửa hàng số 5 ở Hà Nội';
      const wordCount = text.split(/\s+/).length;
      const tokenCount = await service.countTokens(text);
      // Diacritic-heavy Vietnamese typically tokenizes to >1.5x word count
      expect(tokenCount).toBeGreaterThan(wordCount);
    });
  });

  // ── countTokens ─────────────────────────────────────────────────────

  describe('countTokens', () => {
    it('returns 0 for empty string', async () => {
      expect(await service.countTokens('')).toBe(0);
    });

    it('returns positive count for non-empty text', async () => {
      const count = await service.countTokens('Hello world');
      expect(count).toBeGreaterThan(0);
    });
  });

  // ── Encoder reuse ───────────────────────────────────────────────────

  describe('encoder caching', () => {
    it('reuses same encoder across calls with same model', async () => {
      // Two consecutive calls — the second should hit the cached encoder.
      // We can't directly observe the cache, but timing + correctness gives
      // confidence; main test is that it doesn't throw.
      await service.chunk('Hello world', { size: 50, overlap: 10 });
      const chunks = await service.chunk('Foo bar baz', {
        size: 50,
        overlap: 10,
      });
      expect(chunks.length).toBe(1);
    });

    it('switches encoder when a different model is requested', async () => {
      await service.chunk('Hello world', {
        size: 50,
        overlap: 10,
        model: 'text-embedding-3-small',
      });
      // Different model — should swap the cached encoder without error.
      const chunks = await service.chunk('Hello world', {
        size: 50,
        overlap: 10,
        model: 'text-embedding-ada-002',
      });
      expect(chunks.length).toBe(1);
    });
  });
});
