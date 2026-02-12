import type { GovernorConfig } from "./types.js";

/**
 * Presets — opinionated config objects for common use cases.
 *
 * Each preset returns a plain `GovernorConfig` you can spread/override:
 *
 * ```ts
 * const gov = createGovernor(presets.balanced());
 * // or override one field:
 * const gov = createGovernor({ ...presets.balanced(), leaseTtlMs: 30_000 });
 * ```
 */
export const presets = {
  /**
   * **Quiet** — conservative, low-throughput.
   *
   * Best for: personal projects, CLI tools, single-user apps.
   * - maxInFlight: 1 (one call at a time)
   * - rate: 10 req/min
   * - No fairness (single user)
   */
  quiet(): GovernorConfig {
    return {
      concurrency: { maxInFlight: 1 },
      rate: { requestsPerMinute: 10 },
      leaseTtlMs: 30_000,
    };
  },

  /**
   * **Balanced** — sensible defaults for most apps.
   *
   * Best for: SaaS backends, API servers, multi-user apps.
   * - maxInFlight: 5, with 2 interactive reserve
   * - rate: 60 req/min, 100K tokens/min
   * - Fairness enabled (default 60% soft cap)
   */
  balanced(): GovernorConfig {
    return {
      concurrency: { maxInFlight: 5, interactiveReserve: 2 },
      rate: { requestsPerMinute: 60, tokensPerMinute: 100_000 },
      fairness: true,
      leaseTtlMs: 60_000,
    };
  },

  /**
   * **Aggressive** — high throughput with safety nets.
   *
   * Best for: batch processing, high-volume APIs, internal services.
   * - maxInFlight: 20, with 5 interactive reserve
   * - rate: 300 req/min, 500K tokens/min
   * - Fairness + adaptive enabled
   */
  aggressive(): GovernorConfig {
    return {
      concurrency: { maxInFlight: 20, interactiveReserve: 5 },
      rate: { requestsPerMinute: 300, tokensPerMinute: 500_000 },
      fairness: true,
      adaptive: true,
      leaseTtlMs: 120_000,
    };
  },
} as const;
