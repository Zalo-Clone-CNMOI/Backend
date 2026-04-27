import {
  extractJsonCandidate,
  parseJsonResponse,
  validateSuggestions,
  validateLanguageCode,
  validateSourceIndices,
} from './parse-json.util';

describe('extractJsonCandidate', () => {
  it('returns plain JSON object as-is', () => {
    expect(extractJsonCandidate('{"a":1}')).toBe('{"a":1}');
  });

  it('strips markdown json fence', () => {
    expect(extractJsonCandidate('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips plain markdown fence', () => {
    expect(extractJsonCandidate('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('extracts object from surrounding prose', () => {
    const result = extractJsonCandidate('Sure! Here you go: {"a":1} enjoy!');
    expect(result).toBe('{"a":1}');
  });

  it('returns empty string for empty input', () => {
    expect(extractJsonCandidate('')).toBe('');
  });

  it('returns trimmed input when no JSON object found', () => {
    expect(extractJsonCandidate('  no json here  ')).toBe('no json here');
  });
});

describe('parseJsonResponse', () => {
  it('parses plain JSON', () => {
    expect(parseJsonResponse('{"x":42}')).toEqual({ x: 42 });
  });

  it('parses fenced JSON', () => {
    expect(parseJsonResponse('```json\n{"x":42}\n```')).toEqual({ x: 42 });
  });

  it('throws for non-JSON input', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    expect(() => parseJsonResponse('not json')).toThrow();
  });
});

describe('validateSuggestions', () => {
  it('returns up to 3 strings', () => {
    expect(validateSuggestions(['a', 'b', 'c', 'd'])).toHaveLength(3);
  });

  it('trims strings exceeding maxLen', () => {
    const long = 'x'.repeat(100);
    const result = validateSuggestions([long], 80);
    expect(result[0]).toHaveLength(80);
  });

  it('filters non-string items', () => {
    expect(validateSuggestions([1, null, 'hello', true])).toEqual(['hello']);
  });

  it('filters empty strings', () => {
    expect(validateSuggestions(['', '  ', 'ok'])).toEqual(['ok']);
  });

  it('returns empty array for non-array input', () => {
    expect(validateSuggestions(null)).toEqual([]);
    expect(validateSuggestions('string')).toEqual([]);
  });
});

describe('validateLanguageCode', () => {
  it('accepts valid 2-letter codes', () => {
    expect(validateLanguageCode('vi', 'auto')).toBe('vi');
    expect(validateLanguageCode('en', 'auto')).toBe('en');
  });

  it('lowercases valid codes', () => {
    expect(validateLanguageCode('VI', 'auto')).toBe('vi');
  });

  it('falls back for codes longer than 2 chars', () => {
    expect(validateLanguageCode('vie', 'auto')).toBe('auto');
    expect(validateLanguageCode('Vietnamese', 'auto')).toBe('auto');
  });

  it('falls back for non-string input', () => {
    expect(validateLanguageCode(42, 'auto')).toBe('auto');
    expect(validateLanguageCode(null, 'auto')).toBe('auto');
    expect(validateLanguageCode(undefined, 'auto')).toBe('auto');
  });

  it('falls back for empty string', () => {
    expect(validateLanguageCode('', 'auto')).toBe('auto');
  });
});

describe('validateSourceIndices', () => {
  it('returns valid 1-based indices within chunkCount', () => {
    expect(validateSourceIndices([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it('filters indices out of range', () => {
    expect(validateSourceIndices([0, 1, 4], 3)).toEqual([1]);
  });

  it('deduplicates and sorts', () => {
    expect(validateSourceIndices([3, 1, 2, 2, 1], 3)).toEqual([1, 2, 3]);
  });

  it('rounds float indices', () => {
    expect(validateSourceIndices([1.7, 2.3], 3)).toEqual([2]);
  });

  it('returns empty array for non-array input', () => {
    expect(validateSourceIndices(null, 5)).toEqual([]);
    expect(validateSourceIndices('1,2', 5)).toEqual([]);
  });

  it('returns empty array when all indices are out of range', () => {
    expect(validateSourceIndices([5, 6], 3)).toEqual([]);
  });
});
