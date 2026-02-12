/** Minimum retryAfterMs returned to callers. */
export const RETRY_MIN_MS = 25;

/** Maximum retryAfterMs returned to callers. */
export const RETRY_MAX_MS = 5_000;

/**
 * Clamp a raw retryAfterMs value to sane bounds.
 * Ensures callers never spin-loop (min 25 ms) and never wait too long (max 5 s).
 */
export function clampRetry(ms: number): number {
  return Math.max(RETRY_MIN_MS, Math.min(RETRY_MAX_MS, Math.round(ms)));
}
