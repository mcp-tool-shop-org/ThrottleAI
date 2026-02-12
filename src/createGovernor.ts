import type { GovernorConfig } from "./types.js";
import { Governor } from "./governor.js";

/**
 * Create a new ThrottleAI governor.
 *
 * @example
 * ```ts
 * const gov = createGovernor({
 *   concurrency: { maxInFlight: 2 },
 *   rate: { requestsPerMinute: 30 },
 *   leaseTtlMs: 60_000,
 * });
 * ```
 */
export function createGovernor(config: GovernorConfig): Governor {
  return new Governor(config);
}
