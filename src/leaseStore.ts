import type { Lease } from "./types.js";
import { now } from "./utils/time.js";

export type OnExpired = (leases: Lease[]) => void;

export class LeaseStore {
  private readonly _leases = new Map<string, Lease>();
  private readonly _byIdempotency = new Map<string, string>(); // key → leaseId
  private _reaperTimer: ReturnType<typeof setInterval> | null = null;
  private _onExpired: OnExpired | null = null;

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  add(lease: Lease): void {
    this._leases.set(lease.leaseId, lease);
    if (lease.idempotencyKey) {
      this._byIdempotency.set(lease.idempotencyKey, lease.leaseId);
    }
  }

  get(leaseId: string): Lease | undefined {
    return this._leases.get(leaseId);
  }

  remove(leaseId: string): Lease | undefined {
    const lease = this._leases.get(leaseId);
    if (!lease) return undefined;
    this._leases.delete(leaseId);
    if (lease.idempotencyKey) {
      this._byIdempotency.delete(lease.idempotencyKey);
    }
    return lease;
  }

  getByIdempotencyKey(key: string): Lease | undefined {
    const leaseId = this._byIdempotency.get(key);
    if (!leaseId) return undefined;
    const lease = this._leases.get(leaseId);
    // Clean up stale index if lease was removed
    if (!lease) {
      this._byIdempotency.delete(key);
      return undefined;
    }
    return lease;
  }

  get size(): number {
    return this._leases.size;
  }

  // -------------------------------------------------------------------------
  // TTL reaper
  // -------------------------------------------------------------------------

  startReaper(intervalMs: number, onExpired: OnExpired): void {
    this.stopReaper();
    this._onExpired = onExpired;
    this._reaperTimer = setInterval(() => this._sweep(), intervalMs);
    // Don't prevent Node from exiting
    if (this._reaperTimer.unref) {
      this._reaperTimer.unref();
    }
  }

  stopReaper(): void {
    if (this._reaperTimer !== null) {
      clearInterval(this._reaperTimer);
      this._reaperTimer = null;
    }
    this._onExpired = null;
  }

  /** Manually sweep expired leases (also used by the interval). */
  sweep(): Lease[] {
    return this._sweep();
  }

  private _sweep(): Lease[] {
    const expired: Lease[] = [];
    const timestamp = now();

    for (const [id, lease] of this._leases) {
      if (lease.expiresAt <= timestamp) {
        this._leases.delete(id);
        if (lease.idempotencyKey) {
          this._byIdempotency.delete(lease.idempotencyKey);
        }
        expired.push(lease);
      }
    }

    if (expired.length > 0 && this._onExpired) {
      this._onExpired(expired);
    }

    return expired;
  }
}
