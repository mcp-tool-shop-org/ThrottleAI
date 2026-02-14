/**
 * Lightweight stats collector — subscribe to `onEvent`, get numbers.
 *
 * Zero dependencies. Pure functions. No timers.
 *
 * ```ts
 * import { createGovernor, createStatsCollector } from "throttleai";
 *
 * const stats = createStatsCollector();
 * const gov = createGovernor({ ...config, onEvent: stats.handler });
 *
 * // Later:
 * console.log(stats.snapshot());
 * // { grants: 42, denials: 3, releases: 39, expires: 0, denyRate: 0.067, ... }
 *
 * stats.reset(); // clear counters
 * ```
 *
 * For latency tracking, call `stats.recordLatency(ms)` in your release flow:
 * ```ts
 * gov.release(leaseId, { outcome: "success", latencyMs: elapsed });
 * stats.recordLatency(elapsed);
 * ```
 *
 * Or use adapters — they report latency automatically via release events.
 *
 * @module
 */

import type { GovernorEvent, GovernorEventHandler, DenyReason } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Point-in-time stats snapshot. */
export interface StatsSnapshot {
  /** Total acquire grants. */
  grants: number;
  /** Total denials. */
  denials: number;
  /** Denial breakdown by reason. */
  denialsByReason: Record<DenyReason, number>;
  /** Total releases (explicit). */
  releases: number;
  /** Total lease expirations. */
  expires: number;
  /** Deny rate as a fraction (0–1). NaN if no decisions yet. */
  denyRate: number;
  /** Average latency in ms. NaN if no `recordLatency()` calls yet. */
  avgLatencyMs: number;
  /** Min observed latency in ms. Infinity if no samples. */
  minLatencyMs: number;
  /** Max observed latency in ms. -Infinity if no samples. */
  maxLatencyMs: number;
  /** Number of latency samples recorded. */
  latencySamples: number;
  /** Release outcome counts. */
  outcomes: Record<string, number>;
  /** Total events processed. */
  totalEvents: number;
}

/** A stats collector that can be wired to `onEvent`. */
export interface StatsCollector {
  /** Pass this to `onEvent` in your governor config. */
  handler: GovernorEventHandler;
  /** Record a latency observation in ms. Call this alongside `governor.release()`. */
  recordLatency: (ms: number) => void;
  /** Get a point-in-time snapshot of all stats. */
  snapshot: () => StatsSnapshot;
  /** Reset all counters to zero. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a lightweight stats collector for governor events.
 *
 * Wire it up via `onEvent`:
 * ```ts
 * const stats = createStatsCollector();
 * const gov = createGovernor({ onEvent: stats.handler });
 * ```
 *
 * If you already have an `onEvent` handler, compose them:
 * ```ts
 * const stats = createStatsCollector();
 * const gov = createGovernor({
 *   onEvent: (e) => { stats.handler(e); myOtherHandler(e); },
 * });
 * ```
 */
export function createStatsCollector(): StatsCollector {
  let grants = 0;
  let denials = 0;
  let releases = 0;
  let expires = 0;
  let totalEvents = 0;

  let latencySum = 0;
  let latencyCount = 0;
  let latencyMin = Infinity;
  let latencyMax = -Infinity;

  const denialsByReason: Record<string, number> = {
    concurrency: 0,
    rate: 0,
    budget: 0,
    policy: 0,
  };

  const outcomes: Record<string, number> = {};

  function handler(event: GovernorEvent): void {
    totalEvents++;

    switch (event.type) {
      case "acquire":
        grants++;
        break;

      case "deny":
        denials++;
        if (event.reason) {
          denialsByReason[event.reason] = (denialsByReason[event.reason] ?? 0) + 1;
        }
        break;

      case "release":
        releases++;
        if (event.outcome) {
          outcomes[event.outcome] = (outcomes[event.outcome] ?? 0) + 1;
        }
        break;

      case "expire":
        expires++;
        break;

      // "warn" — counted in totalEvents but no special tracking
    }
  }

  function recordLatency(ms: number): void {
    if (ms > 0) {
      latencySum += ms;
      latencyCount++;
      if (ms < latencyMin) latencyMin = ms;
      if (ms > latencyMax) latencyMax = ms;
    }
  }

  function snapshot(): StatsSnapshot {
    const total = grants + denials;
    return {
      grants,
      denials,
      denialsByReason: { ...denialsByReason } as Record<DenyReason, number>,
      releases,
      expires,
      denyRate: total > 0 ? denials / total : NaN,
      avgLatencyMs: latencyCount > 0 ? latencySum / latencyCount : NaN,
      minLatencyMs: latencyMin,
      maxLatencyMs: latencyMax,
      latencySamples: latencyCount,
      outcomes: { ...outcomes },
      totalEvents,
    };
  }

  function reset(): void {
    grants = 0;
    denials = 0;
    releases = 0;
    expires = 0;
    totalEvents = 0;
    latencySum = 0;
    latencyCount = 0;
    latencyMin = Infinity;
    latencyMax = -Infinity;
    denialsByReason.concurrency = 0;
    denialsByReason.rate = 0;
    denialsByReason.budget = 0;
    denialsByReason.policy = 0;
    for (const key of Object.keys(outcomes)) {
      delete outcomes[key];
    }
  }

  return { handler, recordLatency, snapshot, reset };
}
