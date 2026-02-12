import { now } from "./utils/time.js";

export interface FairnessConfig {
  /** Fraction of maxInFlight weight an actor can hold before soft-cap kicks in (default 0.6). */
  softCapRatio?: number;
  /** How long a denied actor gets priority boost in ms (default 5_000). */
  starvationWindowMs?: number;
}

const DEFAULT_SOFT_CAP_RATIO = 0.6;
const DEFAULT_STARVATION_WINDOW_MS = 5_000;

/**
 * Fairness tracker — prevents any single actor from hogging capacity.
 *
 * Two mechanisms:
 * 1. **Soft cap**: if an actor already holds ≥ softCapRatio of total weight capacity,
 *    new requests are denied with reason "policy" (not a hard block — only kicks in when
 *    pool is under pressure, i.e. available < 50% of max).
 * 2. **Anti-starvation**: recently denied actors are tracked. When multiple actors compete,
 *    a recently-denied actor gets a fairness pass (bypass the soft cap).
 */
export class FairnessTracker {
  private readonly _softCapRatio: number;
  private readonly _starvationWindowMs: number;

  /** actorId → total in-flight weight */
  private readonly _actorWeight = new Map<string, number>();

  /** actorId → timestamp of last denial */
  private readonly _deniedAt = new Map<string, number>();

  constructor(config: FairnessConfig = {}) {
    this._softCapRatio = config.softCapRatio ?? DEFAULT_SOFT_CAP_RATIO;
    this._starvationWindowMs =
      config.starvationWindowMs ?? DEFAULT_STARVATION_WINDOW_MS;
  }

  /**
   * Check if an actor can proceed.
   *
   * @param actorId The actor requesting a lease.
   * @param requestWeight Weight of the new request.
   * @param maxWeight Total weight capacity of the pool.
   * @param currentInFlight Current total in-flight weight across all actors.
   * @returns true if allowed, false if soft-capped.
   */
  check(
    actorId: string,
    requestWeight: number,
    maxWeight: number,
    currentInFlight: number,
  ): boolean {
    const actorCurrent = this._actorWeight.get(actorId) ?? 0;
    const softCap = maxWeight * this._softCapRatio;

    // Only enforce when pool is under pressure (≥50% utilized)
    if (currentInFlight < maxWeight * 0.5) {
      return true;
    }

    // If the actor would exceed the soft cap, check for starvation exemption
    if (actorCurrent + requestWeight > softCap) {
      // Anti-starvation: if this actor was recently denied, grant a pass
      const lastDenied = this._deniedAt.get(actorId);
      if (lastDenied !== undefined && now() - lastDenied < this._starvationWindowMs) {
        this._deniedAt.delete(actorId);
        return true; // Starvation pass
      }
      return false; // Soft-capped
    }

    return true;
  }

  /** Record that an actor acquired a lease with the given weight. */
  recordAcquire(actorId: string, weight: number): void {
    const current = this._actorWeight.get(actorId) ?? 0;
    this._actorWeight.set(actorId, current + weight);
  }

  /** Record that an actor released a lease with the given weight. */
  recordRelease(actorId: string, weight: number): void {
    const current = this._actorWeight.get(actorId) ?? 0;
    const next = Math.max(0, current - weight);
    if (next === 0) {
      this._actorWeight.delete(actorId);
    } else {
      this._actorWeight.set(actorId, next);
    }
  }

  /** Record that an actor was denied (for anti-starvation tracking). */
  recordDenial(actorId: string): void {
    this._deniedAt.set(actorId, now());
  }

  /** Get the in-flight weight for an actor. */
  actorWeight(actorId: string): number {
    return this._actorWeight.get(actorId) ?? 0;
  }

  /** Clean up starvation entries older than the window. */
  prune(): void {
    const cutoff = now() - this._starvationWindowMs;
    for (const [actorId, timestamp] of this._deniedAt) {
      if (timestamp < cutoff) {
        this._deniedAt.delete(actorId);
      }
    }
  }
}
