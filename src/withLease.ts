import type { AcquireRequest, AcquireDecision } from "./types.js";
import type { Governor } from "./governor.js";

/**
 * Strategy for handling denied acquire attempts.
 *
 * - `"deny"` — return immediately on denial (default)
 * - `"wait"` — retry with exponential backoff until granted or maxWaitMs
 * - `"wait-then-deny"` — retry up to maxAttempts, then deny (bounded retries)
 */
export type WithLeaseStrategy = "deny" | "wait" | "wait-then-deny";

export interface WithLeaseOptions {
  /**
   * If true, retry on denial with exponential backoff.
   * @deprecated Use `strategy: "wait"` instead. Kept for backward compatibility.
   */
  wait?: boolean;
  /**
   * Strategy for handling denied acquire attempts.
   *
   * - `"deny"` — return immediately on denial (default)
   * - `"wait"` — retry with exponential backoff until granted or maxWaitMs
   * - `"wait-then-deny"` — retry up to maxAttempts, then deny (bounded retries)
   *
   * Takes precedence over the `wait` boolean.
   */
  strategy?: WithLeaseStrategy;
  /** Max total wait time in ms when retrying (default 10_000). */
  maxWaitMs?: number;
  /** Max retry attempts for "wait-then-deny" strategy (default 3). Ignored for other strategies. */
  maxAttempts?: number;
  /** Initial backoff in ms (default 250). */
  initialBackoffMs?: number;
}

export type WithLeaseResult<T> =
  | { granted: true; result: T }
  | { granted: false; decision: AcquireDecision & { granted: false } };

/**
 * Execute a function under a governor lease.
 *
 * - If granted: runs `fn`, auto-releases with outcome.
 * - If denied + strategy `"deny"`: returns the denied decision immediately.
 * - If denied + strategy `"wait"`: retries with backoff up to `maxWaitMs`.
 * - If denied + strategy `"wait-then-deny"`: retries up to `maxAttempts`, then denies.
 * - Always releases the lease on error (outcome: "error") and re-throws.
 *
 * @example
 * ```ts
 * // Simplest: deny immediately
 * const r1 = await withLease(gov, request, fn);
 *
 * // Wait with backoff
 * const r2 = await withLease(gov, request, fn, { strategy: "wait", maxWaitMs: 5000 });
 *
 * // Bounded retries
 * const r3 = await withLease(gov, request, fn, { strategy: "wait-then-deny", maxAttempts: 3 });
 * ```
 */
export async function withLease<T>(
  governor: Governor,
  request: AcquireRequest,
  fn: (decision: AcquireDecision & { granted: true }) => T | Promise<T>,
  options?: WithLeaseOptions,
): Promise<WithLeaseResult<T>> {
  const strategy = resolveStrategy(options);
  const maxWaitMs = options?.maxWaitMs ?? 10_000;
  const maxAttempts = options?.maxAttempts ?? 3;
  const initialBackoff = options?.initialBackoffMs ?? 250;

  let elapsed = 0;
  let attempts = 0;
  let backoff = initialBackoff;

  for (;;) {
    const decision = governor.acquire(request);
    attempts++;

    if (decision.granted) {
      try {
        const result = await fn(decision);
        governor.release(decision.leaseId, { outcome: "success" });
        return { granted: true, result };
      } catch (err) {
        governor.release(decision.leaseId, { outcome: "error" });
        throw err;
      }
    }

    // Denied — check if we should retry
    const shouldRetry =
      strategy === "wait"
        ? elapsed < maxWaitMs
        : strategy === "wait-then-deny"
          ? attempts < maxAttempts && elapsed < maxWaitMs
          : false; // "deny" never retries

    if (!shouldRetry) {
      return {
        granted: false,
        decision: decision as AcquireDecision & { granted: false },
      };
    }

    // Wait and retry
    const waitTime = Math.min(
      backoff,
      decision.retryAfterMs,
      maxWaitMs - elapsed,
    );
    await sleep(waitTime);
    elapsed += waitTime;
    backoff = Math.min(backoff * 2, 5_000); // exponential up to 5s cap
  }
}

/** Resolve strategy from options, handling backward-compatible `wait` boolean. */
function resolveStrategy(options?: WithLeaseOptions): WithLeaseStrategy {
  if (options?.strategy) return options.strategy;
  if (options?.wait) return "wait";
  return "deny";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
