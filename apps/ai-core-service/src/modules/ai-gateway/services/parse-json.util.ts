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

export function parseJsonResponse(content: string): unknown {
  return JSON.parse(extractJsonCandidate(content));
}

export function validateSuggestions(raw: unknown, maxLen = 80): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .slice(0, 3)
    .map((s) => (s.length > maxLen ? s.slice(0, maxLen) : s));
}

export function validateLanguageCode(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && /^[a-z]{2}$/i.test(raw.trim())) {
    return raw.trim().toLowerCase();
  }
  return fallback;
}

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
