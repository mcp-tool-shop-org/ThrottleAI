import { now } from "../utils/time.js";

export interface RatePoolConfig {
  requestsPerMinute: number;
  /** Rolling window size in ms (default 60_000). */
  windowMs?: number;
}

export interface RateResult {
  ok: boolean;
  retryAfterMs?: number;
  reason?: string;
}

export class RatePool {
  private readonly _limit: number;
  private readonly _windowMs: number;
  private readonly _timestamps: number[] = [];

  constructor(config: RatePoolConfig) {
    this._limit = config.requestsPerMinute;
    this._windowMs = config.windowMs ?? 60_000;
  }

  tryAcquire(): RateResult {
    this._prune();

    if (this._timestamps.length >= this._limit) {
      // Oldest entry determines when a slot opens
      const oldest = this._timestamps[0];
      const retryAfterMs = oldest + this._windowMs - now();
      return {
        ok: false,
        retryAfterMs: Math.max(1, retryAfterMs),
        reason: "rate",
      };
    }

    return { ok: true };
  }

  /** Record a successful acquisition (call after tryAcquire returns ok). */
  record(): void {
    this._timestamps.push(now());
  }

  get currentCount(): number {
    this._prune();
    return this._timestamps.length;
  }

  get limit(): number {
    return this._limit;
  }

  private _prune(): void {
    const cutoff = now() - this._windowMs;
    while (this._timestamps.length > 0 && this._timestamps[0] <= cutoff) {
      this._timestamps.shift();
    }
  }
}
