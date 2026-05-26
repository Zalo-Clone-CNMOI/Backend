import { hashMessageBody } from './hash.util';

describe('hashMessageBody', () => {
  it('is deterministic for the same input', () => {
    expect(hashMessageBody('hello world')).toBe(hashMessageBody('hello world'));
  });

  it('returns a 64-char hex sha256 digest', () => {
    const digest = hashMessageBody('any text');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is case-insensitive', () => {
    expect(hashMessageBody('Hello World')).toBe(hashMessageBody('hello world'));
    expect(hashMessageBody('HELLO WORLD')).toBe(hashMessageBody('hello world'));
  });

  it('is insensitive to leading/trailing whitespace', () => {
    expect(hashMessageBody('  hi  ')).toBe(hashMessageBody('hi'));
  });

  it('collapses runs of whitespace to a single space', () => {
    expect(hashMessageBody('a   b\tc\nd')).toBe(hashMessageBody('a b c d'));
  });

  it('normalizes Unicode (NFC) so composed/decomposed forms collapse', () => {
    // 'é' composed (U+00E9) vs 'e' + combining acute (U+0065 U+0301)
    const composed = 'café';
    const decomposed = 'café';
    expect(composed).not.toBe(decomposed);
    expect(hashMessageBody(composed)).toBe(hashMessageBody(decomposed));
  });

  it('DOES NOT slice — long messages with identical prefixes produce DIFFERENT digests', () => {
    // Regression guard: an earlier draft sliced body to 1000 chars BEFORE
    // hashing, which would have caused these two distinct messages to
    // collide on the same cache key. Hashing the full body prevents this.
    const prefix = 'a'.repeat(1000);
    const left = prefix + 'first tail';
    const right = prefix + 'second tail';
    expect(hashMessageBody(left)).not.toBe(hashMessageBody(right));
  });

  it('distinguishes meaningfully different messages', () => {
    expect(hashMessageBody('hi')).not.toBe(hashMessageBody('hello'));
  });

  it('handles empty string deterministically', () => {
    const empty1 = hashMessageBody('');
    const empty2 = hashMessageBody('   ');
    // Both normalize to '' → same digest
    expect(empty1).toBe(empty2);
    expect(empty1).toMatch(/^[0-9a-f]{64}$/);
  });
});
