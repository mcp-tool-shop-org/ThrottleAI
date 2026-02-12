import type { AcquireDecision, AcquireRequest } from "./types.js";

/**
 * Sleep for the `retryAfterMs` period indicated by a denied decision.
 *
 * Returns immediately if the decision was granted (nothing to wait for).
 *
 * ```ts
 * const decision = gov.acquire(request);
 * if (!decision.granted) {
 *   await waitForRetry(decision);
 *   // retry…
 * }
 * ```
 */
export function waitForRetry(decision: AcquireDecision): Promise<void> {
  if (decision.granted) return Promise.resolve();
  const ms = decision.retryAfterMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Minimal interface for the governor parameter in retryAcquire. */
interface Acquirable {
  acquire(request: AcquireRequest): AcquireDecision;
}

/**
 * Acquire with automatic retry. Retries up to `maxAttempts` times,
 * sleeping for `retryAfterMs` between each attempt.
 *
 * Returns the final decision (granted or denied after all retries exhausted).
 *
 * ```ts
 * import { createGovernor, retryAcquire } from "throttleai";
 *
 * const gov = createGovernor(presets.balanced());
 * const decision = await retryAcquire(gov, request, { maxAttempts: 3 });
 * ```
 */
export async function retryAcquire(
  governor: Acquirable,
  request: AcquireRequest,
  options?: { maxAttempts?: number },
): Promise<AcquireDecision> {
  const maxAttempts = options?.maxAttempts ?? 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const decision = governor.acquire(request);
    if (decision.granted) return decision;

    // Last attempt — don't sleep, just return the denial
    if (attempt === maxAttempts - 1) return decision;

    await waitForRetry(decision);
  }

  // Unreachable, but satisfies TS
  return governor.acquire(request);
}
