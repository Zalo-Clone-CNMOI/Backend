import { createHash } from 'crypto';

/**
 * Normalize a chat-message body for moderation cache keying and hash to a
 * SHA-256 hex digest.
 *
 * Normalization steps (applied before hashing):
 *   1. Unicode NFC normalization — canonicalize composed/decomposed forms
 *      so visually identical strings collapse to one key.
 *   2. Trim leading/trailing whitespace.
 *   3. Lowercase — typical chat messages are case-insensitive for moderation.
 *   4. Collapse runs of whitespace (incl. tabs/newlines) to a single space.
 *
 * NOTE: We do NOT slice the input before hashing. SHA-256 handles arbitrary
 * length, and slicing here would cause two messages that share the first
 * N characters but differ afterwards to collide on the same digest. Any
 * length-based gating (e.g. only cache short messages) is the responsibility
 * of the caller's cache-population rules, NOT this hash function.
 */
export function hashMessageBody(body: string): string {
  const normalized = body
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}
