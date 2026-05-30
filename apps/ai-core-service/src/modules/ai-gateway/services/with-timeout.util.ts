/**
 * Default deadline for a synchronous (request/response) AI completion that a
 * user is actively waiting on (entity-info panel, catch-up summary). Kept below
 * the mobile client's own HTTP timeout so the server resolves first — either
 * with a real result or, via the caller's try/catch, a graceful fallback —
 * instead of the client aborting and showing "Request timeout".
 */
export const AI_SYNC_COMPLETION_TIMEOUT_MS = 25_000;

/**
 * Race a promise against a timeout. Rejects with a descriptive Error if `ms`
 * elapses before `promise` settles; the timer is always cleared so it never
 * keeps the event loop alive.
 *
 * NOTE: this does not ABORT the underlying work — it only stops the caller from
 * waiting. A bounded LLM call may still finish in the background; its result is
 * ignored. That is acceptable here: the goal is to bound how long a user-facing
 * request blocks, and the callers already fall back gracefully on rejection.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
