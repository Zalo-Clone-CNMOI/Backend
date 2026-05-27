import type { PersistedMessage } from '@app/types/interfaces/chat.interface';
import type { LlmCompletionResult } from '../interfaces';
import type { AiMetricsService } from './ai-metrics.service';
import { parseJsonResponse } from './parse-json.util';

/**
 * Stateless summarization helpers shared by CatchUpEngine, SummaryEngine, and
 * (Phase 6 C8) the Zai L2 memory service. Cache scope, prompts, and token
 * budgets intentionally stay per-engine — only the message-filter, JSON-parse,
 * and metrics plumbing are unified here.
 */

/**
 * Filter a message window for summarization. Drops soft-deleted messages,
 * messages at/older than `since` (when provided), and body-less (media-only)
 * messages when `requireBody` is set. Input order is preserved — callers
 * reverse to chronological order as needed.
 */
export function filterMessagesForSummarization(
  messages: PersistedMessage[],
  opts: { since?: number; requireBody?: boolean } = {},
): PersistedMessage[] {
  return messages.filter((m) => {
    if (m.deleted_at) return false;
    if (opts.since !== undefined && m.created_at <= opts.since) return false;
    if (opts.requireBody && !m.body) return false;
    return true;
  });
}

/**
 * Parse the `{ "summary": "..." }` JSON the summarization prompts ask for.
 * Falls back to the raw content when the model returned plain text or invalid
 * JSON — both catch-up and summary tolerate a non-JSON reply.
 */
export function parseAiSummaryJson(content: string): { summary: string } {
  try {
    const json = parseJsonResponse(content) as Record<string, unknown>;
    return {
      summary: typeof json.summary === 'string' ? json.summary : content,
    };
  } catch {
    return { summary: content };
  }
}

/**
 * Record an AI summarization request. Pass the gateway result on success, or
 * `null` on failure — failure records provider/model='unknown', zero tokens,
 * and success=false (matching the prior per-engine behaviour exactly).
 */
export function recordSummarizationMetrics(
  aiMetrics: AiMetricsService,
  operation: string,
  result: LlmCompletionResult | null,
): void {
  if (result) {
    aiMetrics.recordRequest(
      operation,
      result.provider,
      result.model,
      result.tokensIn,
      result.tokensOut,
      result.latencyMs,
      true,
    );
  } else {
    aiMetrics.recordRequest(operation, 'unknown', 'unknown', 0, 0, 0, false);
  }
}
