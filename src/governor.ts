import type {
  GovernorConfig,
  AcquireRequest,
  AcquireDecision,
  ReleaseReport,
  Lease,
} from "./types.js";
import { LeaseStore } from "./leaseStore.js";
import { ConcurrencyPool } from "./pools/concurrency.js";
import { RatePool } from "./pools/rate.js";
import { now } from "./utils/time.js";
import { newLeaseId } from "./utils/id.js";

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_REAPER_INTERVAL_MS = 5_000;

export class Governor {
  private readonly _store: LeaseStore;
  private readonly _concurrency: ConcurrencyPool | null;
  private readonly _rate: RatePool | null;
  private readonly _ttlMs: number;

  constructor(config: GovernorConfig) {
    this._store = new LeaseStore();
    this._ttlMs = config.leaseTtlMs ?? DEFAULT_TTL_MS;

    // Concurrency pool
    this._concurrency = config.concurrency
      ? new ConcurrencyPool(config.concurrency)
      : null;

    // Rate pool
    this._rate = config.rate ? new RatePool(config.rate) : null;

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
        return {
          granted: false,
          reason: "concurrency",
          retryAfterMs: result.retryAfterMs ?? 500,
          recommendation: "reduce concurrency or wait",
        };
      }
    }

    // Rate check
    if (this._rate) {
      const rateResult = this._rate.tryAcquire();
      if (!rateResult.ok) {
        // Roll back concurrency weight if we acquired some
        if (this._concurrency) {
          this._concurrency.release(weight);
        }
        return {
          granted: false,
          reason: "rate",
          retryAfterMs: rateResult.retryAfterMs ?? 1_000,
          recommendation: "reduce request frequency or wait",
        };
      }
      this._rate.record();
    }

    // Issue lease
    const lease: Lease = {
      leaseId: newLeaseId(),
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

    return {
      granted: true,
      leaseId: lease.leaseId,
      expiresAt: lease.expiresAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Release
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  release(leaseId: string, _report?: ReleaseReport): void {
    const lease = this._store.remove(leaseId);
    if (lease && this._concurrency) {
      this._concurrency.release(lease.weight);
    }
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

  get rateCount(): number {
    return this._rate?.currentCount ?? 0;
  }

  get rateLimit(): number {
    return this._rate?.limit ?? Infinity;
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

  private _onExpired(leases: Lease[]): void {
    if (this._concurrency) {
      for (const lease of leases) {
        this._concurrency.release(lease.weight);
      }
    }
  }
}
