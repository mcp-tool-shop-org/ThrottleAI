import type {
  GovernorConfig,
  AcquireRequest,
  AcquireDecision,
  ReleaseReport,
  Lease,
  GovernorSnapshot,
  GovernorEvent,
  GovernorEventHandler,
} from "./types.js";
import { LeaseStore } from "./leaseStore.js";
import { ConcurrencyPool } from "./pools/concurrency.js";
import { RatePool } from "./pools/rate.js";
import { TokenRatePool } from "./pools/tokenRate.js";
import { FairnessTracker } from "./fairness.js";
import { AdaptiveController } from "./adaptive.js";
import { now } from "./utils/time.js";
import { newLeaseId } from "./utils/id.js";
import { clampRetry } from "./utils/retry.js";

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_REAPER_INTERVAL_MS = 5_000;

export class Governor {
  private readonly _store: LeaseStore;
  private readonly _concurrency: ConcurrencyPool | null;
  private readonly _rate: RatePool | null;
  private readonly _tokenRate: TokenRatePool | null;
  private readonly _fairness: FairnessTracker | null;
  private readonly _adaptive: AdaptiveController | null;
  private readonly _ttlMs: number;
  private readonly _onEvent: GovernorEventHandler | null;

  constructor(config: GovernorConfig) {
    this._store = new LeaseStore();
    this._ttlMs = config.leaseTtlMs ?? DEFAULT_TTL_MS;
    this._onEvent = config.onEvent ?? null;

    // Concurrency pool
    this._concurrency = config.concurrency
      ? new ConcurrencyPool(config.concurrency)
      : null;

    // Rate pool (request-rate)
    if (config.rate?.requestsPerMinute) {
      this._rate = new RatePool({
        requestsPerMinute: config.rate.requestsPerMinute,
        windowMs: config.rate.windowMs,
      });
    } else {
      this._rate = null;
    }

    // Token-rate pool
    if (config.rate?.tokensPerMinute) {
      this._tokenRate = new TokenRatePool({
        tokensPerMinute: config.rate.tokensPerMinute,
        windowMs: config.rate.windowMs,
      });
    } else {
      this._tokenRate = null;
    }

    // Fairness tracker (only meaningful with concurrency)
    if (config.fairness && this._concurrency) {
      const fairnessConfig =
        typeof config.fairness === "object" ? config.fairness : {};
      this._fairness = new FairnessTracker(fairnessConfig);
    } else {
      this._fairness = null;
    }

    // Adaptive controller (only meaningful with concurrency)
    if (config.adaptive && this._concurrency) {
      const adaptiveConfig =
        typeof config.adaptive === "object" ? config.adaptive : {};
      this._adaptive = new AdaptiveController(
        config.concurrency!.maxInFlight,
        adaptiveConfig,
      );
    } else {
      this._adaptive = null;
    }

    // Start reaper
    const reaperMs = config.reaperIntervalMs ?? DEFAULT_REAPER_INTERVAL_MS;
    this._store.startReaper(reaperMs, (expired) => this._onExpired(expired));
  }

  // ---------------------------------------------------------------------------
  // Acquire
  // ---------------------------------------------------------------------------

  acquire(request: AcquireRequest): AcquireDecision {
    const priority = request.priority ?? "interactive";
    const weight = request.estimate?.weight ?? 1;

    // Adaptive: maybe adjust effective concurrency
    if (this._adaptive && this._concurrency) {
      const newEffective = this._adaptive.maybeAdjust(now());
      this._concurrency.effectiveMax = newEffective;
    }

    // Idempotency check
    if (request.idempotencyKey) {
      const existing = this._store.getByIdempotencyKey(request.idempotencyKey);
      if (existing) {
        return {
          granted: true,
          leaseId: existing.leaseId,
          expiresAt: existing.expiresAt,
        };
      }
    }

    // Concurrency check
    if (this._concurrency) {
      // Compute ms until the earliest lease expires for precise retryAfter
      const earliestExpiry = this._store.earliestExpiry();
      const earliestExpiryMs =
        earliestExpiry !== undefined ? earliestExpiry - now() : undefined;

      const result = this._concurrency.tryAcquire(
        priority,
        earliestExpiryMs,
        weight,
      );
      if (!result.ok) {
        if (this._fairness) {
          this._fairness.recordDenial(request.actorId);
        }
        if (this._adaptive) {
          this._adaptive.recordDenial();
        }
        this._emit({
          type: "deny",
          timestamp: now(),
          actorId: request.actorId,
          action: request.action,
          reason: "concurrency",
          retryAfterMs: result.retryAfterMs ?? 500,
          weight,
        });
        return {
          granted: false,
          reason: "concurrency",
          retryAfterMs: result.retryAfterMs ?? 500,
          recommendation: "reduce concurrency or wait",
        };
      }

      // Fairness check (after concurrency passes, before committing)
      if (this._fairness) {
        const fair = this._fairness.check(
          request.actorId,
          weight,
          this._concurrency.max,
          this._concurrency.active, // already includes this acquire's weight
        );
        if (!fair) {
          // Roll back the concurrency token
          this._concurrency.release(weight);
          this._fairness.recordDenial(request.actorId);
          if (this._adaptive) {
            this._adaptive.recordDenial();
          }
          const retryMs = clampRetry(earliestExpiryMs ?? 500);
          this._emit({
            type: "deny",
            timestamp: now(),
            actorId: request.actorId,
            action: request.action,
            reason: "policy",
            retryAfterMs: retryMs,
            weight,
          });
          return {
            granted: false,
            reason: "policy",
            retryAfterMs: retryMs,
            recommendation: "actor exceeds fair share — other actors are waiting",
          };
        }
      }
    }

    // Request-rate check
    if (this._rate) {
      const rateResult = this._rate.tryAcquire();
      if (!rateResult.ok) {
        this._rollbackConcurrency(weight);
        const retryMs = rateResult.retryAfterMs ?? 1_000;
        this._emit({
          type: "deny",
          timestamp: now(),
          actorId: request.actorId,
          action: request.action,
          reason: "rate",
          retryAfterMs: retryMs,
          weight,
        });
        return {
          granted: false,
          reason: "rate",
          retryAfterMs: retryMs,
          recommendation: "reduce request frequency or wait",
        };
      }
    }

    // Token-rate check
    if (this._tokenRate) {
      const estimatedTokens = this._estimateTokens(request);
      const tokenResult = this._tokenRate.tryAcquire(estimatedTokens);
      if (!tokenResult.ok) {
        this._rollbackConcurrency(weight);
        const retryMs = tokenResult.retryAfterMs ?? 1_000;
        this._emit({
          type: "deny",
          timestamp: now(),
          actorId: request.actorId,
          action: request.action,
          reason: "rate",
          retryAfterMs: retryMs,
          weight,
        });
        return {
          granted: false,
          reason: "rate",
          retryAfterMs: retryMs,
          recommendation: "reduce token usage or wait",
        };
      }
    }

    // All checks passed — commit rate records
    if (this._rate) {
      this._rate.record();
    }

    // Issue lease
    const leaseId = newLeaseId();
    const estimatedTokens = this._estimateTokens(request);

    if (this._tokenRate) {
      this._tokenRate.record(estimatedTokens, leaseId);
    }

    const lease: Lease = {
      leaseId,
      actorId: request.actorId,
      action: request.action,
      priority,
      expiresAt: now() + this._ttlMs,
      estimate: request.estimate,
      idempotencyKey: request.idempotencyKey,
      createdAt: now(),
      weight,
    };

    this._store.add(lease);

    // Track fairness
    if (this._fairness) {
      this._fairness.recordAcquire(request.actorId, weight);
    }

    // Track adaptive
    if (this._adaptive) {
      this._adaptive.recordAcquire();
    }

    this._emit({
      type: "acquire",
      timestamp: now(),
      leaseId: lease.leaseId,
      actorId: request.actorId,
      action: request.action,
      weight,
    });

    return {
      granted: true,
      leaseId: lease.leaseId,
      expiresAt: lease.expiresAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Release
  // ---------------------------------------------------------------------------

  release(leaseId: string, report?: ReleaseReport): void {
    const lease = this._store.remove(leaseId);
    if (!lease) return;

    if (this._concurrency) {
      this._concurrency.release(lease.weight);
    }
    if (this._fairness) {
      this._fairness.recordRelease(lease.actorId, lease.weight);
    }
    // Update token-rate with actual usage if available
    if (this._tokenRate && report?.usage) {
      const actualTokens =
        (report.usage.promptTokens ?? 0) + (report.usage.outputTokens ?? 0);
      if (actualTokens > 0) {
        this._tokenRate.updateActual(leaseId, actualTokens);
      }
    }
    // Feed latency to adaptive controller
    if (this._adaptive && report?.latencyMs !== undefined) {
      this._adaptive.recordLatency(report.latencyMs);
    }

    this._emit({
      type: "release",
      timestamp: now(),
      leaseId: lease.leaseId,
      actorId: lease.actorId,
      action: lease.action,
      weight: lease.weight,
      outcome: report?.outcome,
    });
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  get activeLeases(): number {
    return this._store.size;
  }

  /** Current in-flight weight (or count when all weights are 1). */
  get concurrencyActive(): number {
    return this._concurrency?.active ?? 0;
  }

  /** Available weight capacity. */
  get concurrencyAvailable(): number {
    return this._concurrency?.available ?? Infinity;
  }

  /** Effective concurrency limit (may be lower than configured max when adaptive is active). */
  get concurrencyEffectiveMax(): number {
    return this._concurrency?.effectiveMax ?? Infinity;
  }

  get rateCount(): number {
    return this._rate?.currentCount ?? 0;
  }

  get rateLimit(): number {
    return this._rate?.limit ?? Infinity;
  }

  /** Current tokens consumed in the active window. */
  get tokenRateCount(): number {
    return this._tokenRate?.currentTokens ?? 0;
  }

  /** Token-rate limit. */
  get tokenRateLimit(): number {
    return this._tokenRate?.limit ?? Infinity;
  }

  // ---------------------------------------------------------------------------
  // Snapshot
  // ---------------------------------------------------------------------------

  /** Return a read-only snapshot of current governor state. */
  snapshot(): GovernorSnapshot {
    return {
      timestamp: now(),
      activeLeases: this._store.size,
      concurrency: this._concurrency
        ? {
            active: this._concurrency.active,
            available: this._concurrency.available,
            max: this._concurrency.max,
            effectiveMax: this._concurrency.effectiveMax,
          }
        : null,
      requestRate: this._rate
        ? {
            current: this._rate.currentCount,
            limit: this._rate.limit,
          }
        : null,
      tokenRate: this._tokenRate
        ? {
            current: this._tokenRate.currentTokens,
            limit: this._tokenRate.limit,
          }
        : null,
      fairness: this._fairness !== null,
      adaptive: this._adaptive !== null,
    };
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose(): void {
    this._store.stopReaper();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private _rollbackConcurrency(weight: number): void {
    if (this._concurrency) {
      this._concurrency.release(weight);
    }
  }

  /** Estimate total tokens from the request's estimate. */
  private _estimateTokens(request: AcquireRequest): number {
    const est = request.estimate;
    if (!est) return 0;
    return (est.promptTokens ?? 0) + (est.maxOutputTokens ?? 0);
  }

  private _onExpired(leases: Lease[]): void {
    for (const lease of leases) {
      if (this._concurrency) {
        this._concurrency.release(lease.weight);
      }
      if (this._fairness) {
        this._fairness.recordRelease(lease.actorId, lease.weight);
      }
      this._emit({
        type: "expire",
        timestamp: now(),
        leaseId: lease.leaseId,
        actorId: lease.actorId,
        action: lease.action,
        weight: lease.weight,
      });
    }
  }

  private _emit(event: GovernorEvent): void {
    if (this._onEvent) {
      this._onEvent(event);
    }
  }
}
