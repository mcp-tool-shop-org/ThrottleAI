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
  private readonly _entries: TokenEntry[] = [];

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
    for (let i = this._entries.length - 1; i >= 0; i--) {
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
    for (const entry of this._entries) {
      total += entry.tokens;
    }
    return total;
  }

  private _prune(): void {
    const cutoff = now() - this._windowMs;
    while (this._entries.length > 0 && this._entries[0].timestamp <= cutoff) {
      this._entries.shift();
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
    for (const entry of this._entries) {
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
