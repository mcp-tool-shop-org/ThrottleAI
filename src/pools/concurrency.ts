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

export class ConcurrencyPool {
  private readonly _max: number;
  private readonly _reserve: number;
  private _active = 0;

  constructor(config: ConcurrencyPoolConfig) {
    this._max = config.maxInFlight;
    this._reserve = config.interactiveReserve ?? 0;

    if (this._reserve >= this._max) {
      throw new Error(
        `interactiveReserve (${this._reserve}) must be less than maxInFlight (${this._max})`,
      );
    }
  }

  /**
   * @param priority Caller priority level.
   * @param earliestExpiryMs Optional: ms until the earliest active lease expires.
   *   When provided, used to compute a precise retryAfterMs instead of a heuristic.
   */
  tryAcquire(priority: Priority, earliestExpiryMs?: number): PoolResult {
    const available = this._max - this._active;

    if (available <= 0) {
      return {
        ok: false,
        retryAfterMs: this._computeRetry(earliestExpiryMs),
        reason: "concurrency",
      };
    }

    // Background callers cannot consume the reserve
    if (priority === "background" && available <= this._reserve) {
      return {
        ok: false,
        retryAfterMs: this._computeRetry(earliestExpiryMs),
        reason: "concurrency",
      };
    }

    this._active++;
    return { ok: true };
  }

  release(): void {
    if (this._active > 0) {
      this._active--;
    }
  }

  get active(): number {
    return this._active;
  }

  get available(): number {
    return this._max - this._active;
  }

  get max(): number {
    return this._max;
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
    const pressure = this._active / this._max;
    return clampRetry(Math.round(250 + pressure * 750));
  }
}
