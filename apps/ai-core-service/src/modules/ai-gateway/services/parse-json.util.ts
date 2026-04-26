/**
 * Shared LLM response JSON parsing utilities.
 *
 * LLMs sometimes wrap JSON in markdown fences (```json...```) or add prose
 * before/after the object. These helpers strip that noise before parsing,
 * preventing silent fallbacks on otherwise valid responses.
 */

export function extractJsonCandidate(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return trimmed;

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseJsonResponse(content: string): any {
  return JSON.parse(extractJsonCandidate(content));
}

// ── Per-feature output validators ────────────────────────────────────────────

/** Clamp each suggestion to maxLen chars and return at most 3. */
export function validateSuggestions(raw: unknown, maxLen = 80): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .slice(0, 3)
    .map((s) => (s.length > maxLen ? s.slice(0, maxLen) : s));
}

/**
 * Normalise an ISO 639-1 language code.
 * Returns the code as-is if it is 2 alphabetic chars; otherwise `fallback`.
 */
export function validateLanguageCode(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && /^[a-z]{2}$/i.test(raw.trim())) {
    return raw.trim().toLowerCase();
  }
  return fallback;
}

/**
 * Filter source_indices to only valid 1-based numbers within `chunkCount`.
 * Deduplicates and sorts the result.
 */
export function validateSourceIndices(
  raw: unknown,
  chunkCount: number,
): number[] {
  if (!Array.isArray(raw)) return [];
  const valid = (raw as unknown[])
    .filter(
      (n): n is number => typeof n === 'number' && n >= 1 && n <= chunkCount,
    )
    .map(Math.round);
  return [...new Set(valid)].sort((a, b) => a - b);
}
