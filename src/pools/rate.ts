import { now } from "../utils/time.js";
import { clampRetry } from "../utils/retry.js";

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

  // Rolling window timestamps.
  //
  // We keep an index pointer instead of shift() to avoid O(n²) behavior under
  // large windows or aggressive presets.
  private readonly _timestamps: number[] = [];
  private _head = 0;

  constructor(config: RatePoolConfig) {
    this._limit = config.requestsPerMinute;
    this._windowMs = config.windowMs ?? 60_000;
  }

  tryAcquire(): RateResult {
    this._prune();

    if (this._size() >= this._limit) {
      // Oldest entry determines when a slot opens
      const oldest = this._timestamps[this._head];
      const rawMs = oldest + this._windowMs - now();
      return {
        ok: false,
        retryAfterMs: clampRetry(rawMs),
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
    return this._size();
  }

  get limit(): number {
    return this._limit;
  }

  private _size(): number {
    return this._timestamps.length - this._head;
  }

  private _prune(): void {
    const cutoff = now() - this._windowMs;

    while (
      this._head < this._timestamps.length &&
      this._timestamps[this._head] <= cutoff
    ) {
      this._head++;
    }

    // Compact occasionally to avoid unbounded growth when the head advances.
    if (this._head > 1024 && this._head > (this._timestamps.length >> 1)) {
      this._timestamps.splice(0, this._head);
      this._head = 0;
    }
  }
}
