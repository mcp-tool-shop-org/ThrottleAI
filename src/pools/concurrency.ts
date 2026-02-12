import type { Priority } from "../types.js";
import { clampRetry } from "../utils/retry.js";

export interface ConcurrencyPoolConfig {
  maxInFlight: number;
  interactiveReserve?: number;
}

export interface PoolResult {
  ok: boolean;
  retryAfterMs?: number;
  reason?: string;
}

/**
 * Weight-aware concurrency pool.
 *
 * `maxInFlight` is the total weight capacity.
 * Each acquire specifies a weight (default 1), so legacy callers with
 * weight=1 behave exactly like the original count-based pool.
 */
export class ConcurrencyPool {
  private readonly _maxWeight: number;
  private readonly _reserveWeight: number;
  private _inFlightWeight = 0;

  constructor(config: ConcurrencyPoolConfig) {
    this._maxWeight = config.maxInFlight;
    this._reserveWeight = config.interactiveReserve ?? 0;

    if (this._reserveWeight >= this._maxWeight) {
      throw new Error(
        `interactiveReserve (${this._reserveWeight}) must be less than maxInFlight (${this._maxWeight})`,
      );
    }
  }

  /**
   * @param priority Caller priority level.
   * @param earliestExpiryMs Optional: ms until the earliest active lease expires.
   * @param weight Concurrency weight for this call (default 1).
   */
  tryAcquire(
    priority: Priority,
    earliestExpiryMs?: number,
    weight = 1,
  ): PoolResult {
    const availableWeight = this._maxWeight - this._inFlightWeight;

    if (availableWeight < weight) {
      return {
        ok: false,
        retryAfterMs: this._computeRetry(earliestExpiryMs),
        reason: "concurrency",
      };
    }

    // Background callers cannot consume the reserve
    if (
      priority === "background" &&
      availableWeight - weight < this._reserveWeight
    ) {
      return {
        ok: false,
        retryAfterMs: this._computeRetry(earliestExpiryMs),
        reason: "concurrency",
      };
    }

    this._inFlightWeight += weight;
    return { ok: true };
  }

  /** Release weight back to the pool. */
  release(weight = 1): void {
    this._inFlightWeight = Math.max(0, this._inFlightWeight - weight);
  }

  /** Current in-flight weight. */
  get active(): number {
    return this._inFlightWeight;
  }

  /** Available weight capacity. */
  get available(): number {
    return this._maxWeight - this._inFlightWeight;
  }

  /** Maximum weight capacity. */
  get max(): number {
    return this._maxWeight;
  }

  /**
   * Compute retryAfterMs.
   * If earliestExpiryMs is provided and positive, use it (clamped).
   * Otherwise, fall back to a pressure-based heuristic.
   */
  private _computeRetry(earliestExpiryMs?: number): number {
    if (earliestExpiryMs !== undefined && earliestExpiryMs > 0) {
      return clampRetry(earliestExpiryMs);
    }
    // Fallback: pressure-based heuristic
    const pressure = this._inFlightWeight / this._maxWeight;
    return clampRetry(Math.round(250 + pressure * 750));
  }
}
