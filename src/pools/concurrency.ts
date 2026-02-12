import type { Priority } from "../types.js";

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

  tryAcquire(priority: Priority): PoolResult {
    const available = this._max - this._active;

    if (available <= 0) {
      return {
        ok: false,
        retryAfterMs: this._heuristicRetry(),
        reason: "concurrency",
      };
    }

    // Background callers cannot consume the reserve
    if (priority === "background" && available <= this._reserve) {
      return {
        ok: false,
        retryAfterMs: this._heuristicRetry(),
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

  private _heuristicRetry(): number {
    // Scale retry hint with pressure: more active = longer wait
    const pressure = this._active / this._max;
    return Math.round(250 + pressure * 750); // 250–1000ms
  }
}
