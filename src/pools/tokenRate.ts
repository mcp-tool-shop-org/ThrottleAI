import { now } from "../utils/time.js";
import { clampRetry } from "../utils/retry.js";

export interface TokenRatePoolConfig {
  tokensPerMinute: number;
  /** Rolling window size in ms (default 60_000). */
  windowMs?: number;
}

export interface TokenRateResult {
  ok: boolean;
  retryAfterMs?: number;
  reason?: string;
}

interface TokenEntry {
  timestamp: number;
  tokens: number;
  /** Lease ID for updating with actual usage on release. */
  leaseId?: string;
}

/**
 * Token-rate limiter using a rolling window of (timestamp, amount) tuples.
 *
 * On acquire: estimated tokens (promptTokens + maxOutputTokens) checked against budget.
 * On release: entries can be updated with actual token usage.
 */
export class TokenRatePool {
  private readonly _limit: number;
  private readonly _windowMs: number;

  // Rolling window entries.
  //
  // We keep an index pointer instead of shift() to avoid O(n²) behavior under
  // large windows or aggressive presets.
  private readonly _entries: TokenEntry[] = [];
  private _head = 0;

  constructor(config: TokenRatePoolConfig) {
    this._limit = config.tokensPerMinute;
    this._windowMs = config.windowMs ?? 60_000;
  }

  /**
   * Check if the estimated token count fits within the budget.
   * @param estimatedTokens The estimated total tokens for this request.
   */
  tryAcquire(estimatedTokens: number): TokenRateResult {
    this._prune();

    const currentTokens = this._sumTokens();
    if (currentTokens + estimatedTokens > this._limit) {
      // Find when enough tokens will expire to make room
      const retryMs = this._computeRetryMs(estimatedTokens);
      return {
        ok: false,
        retryAfterMs: clampRetry(retryMs),
        reason: "rate",
      };
    }

    return { ok: true };
  }

  /** Record a token acquisition. */
  record(estimatedTokens: number, leaseId?: string): void {
    this._entries.push({
      timestamp: now(),
      tokens: estimatedTokens,
      leaseId,
    });
  }

  /**
   * Update an existing entry with actual token usage.
   * If actual < estimated, the difference is freed immediately.
   * If actual > estimated, the overage is added (best-effort tracking).
   */
  updateActual(leaseId: string, actualTokens: number): void {
    for (let i = this._entries.length - 1; i >= this._head; i--) {
      if (this._entries[i].leaseId === leaseId) {
        this._entries[i].tokens = actualTokens;
        return;
      }
    }
    // If not found (already pruned), no-op
  }

  /** Current tokens consumed in the active window. */
  get currentTokens(): number {
    this._prune();
    return this._sumTokens();
  }

  get limit(): number {
    return this._limit;
  }

  private _sumTokens(): number {
    let total = 0;
    for (let i = this._head; i < this._entries.length; i++) {
      total += this._entries[i].tokens;
    }
    return total;
  }

  private _prune(): void {
    const cutoff = now() - this._windowMs;

    while (
      this._head < this._entries.length &&
      this._entries[this._head].timestamp <= cutoff
    ) {
      this._head++;
    }

    // Compact occasionally to avoid unbounded growth when the head advances.
    if (this._head > 1024 && this._head > (this._entries.length >> 1)) {
      this._entries.splice(0, this._head);
      this._head = 0;
    }
  }

  /**
   * Compute how long until enough tokens expire to fit `needed` more tokens.
   */
  private _computeRetryMs(needed: number): number {
    const surplus = this._sumTokens() + needed - this._limit;
    if (surplus <= 0) return 0;

    // Walk entries oldest-first, accumulating freed tokens
    let freed = 0;
    for (let i = this._head; i < this._entries.length; i++) {
      const entry = this._entries[i];
      freed += entry.tokens;
      if (freed >= surplus) {
        // This entry's expiry time frees enough
        return entry.timestamp + this._windowMs - now();
      }
    }

    // All entries would need to expire
    const last = this._entries[this._entries.length - 1];
    return last ? last.timestamp + this._windowMs - now() : this._windowMs;
  }
}
