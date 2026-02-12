import type { AcquireRequest, AcquireDecision } from "./types.js";
import type { Governor } from "./governor.js";

export interface WithLeaseOptions {
  /** If true, retry on denial with exponential backoff. */
  wait?: boolean;
  /** Max total wait time in ms when wait=true (default 10_000). */
  maxWaitMs?: number;
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
 * - If denied + `options.wait`: retries with backoff up to `maxWaitMs`.
 * - If denied + no wait: returns the denied decision immediately.
 * - Always releases the lease on error (outcome: "error") and re-throws.
 *
 * @example
 * ```ts
 * const result = await withLease(gov, { actorId: "user", action: "chat" }, async () => {
 *   return await callModel();
 * });
 *
 * if (result.granted) {
 *   console.log(result.result);
 * } else {
 *   console.log("Denied:", result.decision.reason);
 * }
 * ```
 */
export async function withLease<T>(
  governor: Governor,
  request: AcquireRequest,
  fn: (decision: AcquireDecision & { granted: true }) => T | Promise<T>,
  options?: WithLeaseOptions,
): Promise<WithLeaseResult<T>> {
  const wait = options?.wait ?? false;
  const maxWaitMs = options?.maxWaitMs ?? 10_000;
  const initialBackoff = options?.initialBackoffMs ?? 250;

  let elapsed = 0;
  let backoff = initialBackoff;

  for (;;) {
    const decision = governor.acquire(request);

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

    // Denied
    if (!wait || elapsed >= maxWaitMs) {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
