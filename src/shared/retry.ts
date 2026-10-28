/**
 * Produces a bounded retry delay for HTTP rate limiting.
 * Returns null when the server explicitly requests a wait longer than our automatic retry
 * window; callers should surface the rate-limit response instead of retrying earlier than asked.
 */
export const computeRetryDelayMs = (
  attempt: number,
  retryAfterMs: number | null,
  baseDelayMs = 1000,
  maxDelayMs = 120_000
): number | null => {
  const safeMax = Number.isFinite(maxDelayMs) && maxDelayMs >= 0 ? maxDelayMs : 120_000;
  const safeBase = Number.isFinite(baseDelayMs) && baseDelayMs >= 0 ? baseDelayMs : 1000;

  if (retryAfterMs !== null && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return retryAfterMs > safeMax ? null : retryAfterMs;
  }

  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(safeMax, safeBase * Math.pow(2, Math.min(safeAttempt, 30)));
};
