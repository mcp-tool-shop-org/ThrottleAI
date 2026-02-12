import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LeaseStore } from "../src/leaseStore.js";
import { setNow, resetNow } from "../src/utils/time.js";
import type { Lease } from "../src/types.js";

function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    leaseId: `lease-${Math.random().toString(36).slice(2)}`,
    actorId: "test-actor",
    action: "chat.completion",
    priority: "interactive",
    expiresAt: Date.now() + 60_000,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("LeaseStore", () => {
  let store: LeaseStore;

  beforeEach(() => {
    store = new LeaseStore();
    resetNow();
  });

  afterEach(() => {
    store.stopReaper();
    resetNow();
  });

  it("add → get returns the lease", () => {
    const lease = makeLease();
    store.add(lease);
    expect(store.get(lease.leaseId)).toEqual(lease);
    expect(store.size).toBe(1);
  });

  it("remove → get returns undefined", () => {
    const lease = makeLease();
    store.add(lease);
    const removed = store.remove(lease.leaseId);
    expect(removed).toEqual(lease);
    expect(store.get(lease.leaseId)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("remove non-existent returns undefined", () => {
    expect(store.remove("nope")).toBeUndefined();
  });

  it("idempotency: same key returns same lease", () => {
    const lease = makeLease({ idempotencyKey: "idem-1" });
    store.add(lease);
    const found = store.getByIdempotencyKey("idem-1");
    expect(found?.leaseId).toBe(lease.leaseId);
  });

  it("idempotency: unknown key returns undefined", () => {
    expect(store.getByIdempotencyKey("nope")).toBeUndefined();
  });

  it("idempotency: removed lease cleans up index on lookup", () => {
    const lease = makeLease({ idempotencyKey: "idem-2" });
    store.add(lease);
    store.remove(lease.leaseId);
    expect(store.getByIdempotencyKey("idem-2")).toBeUndefined();
  });

  it("sweep removes expired leases", () => {
    let time = 1000;
    setNow(() => time);

    const active = makeLease({ expiresAt: 2000 });
    const expired = makeLease({ expiresAt: 500 });
    store.add(active);
    store.add(expired);

    const swept = store.sweep();
    expect(swept).toHaveLength(1);
    expect(swept[0].leaseId).toBe(expired.leaseId);
    expect(store.size).toBe(1);
    expect(store.get(active.leaseId)).toBeDefined();
  });

  it("sweep calls onExpired callback via reaper", async () => {
    let time = 1000;
    setNow(() => time);

    const lease = makeLease({ expiresAt: 1500 });
    store.add(lease);

    const onExpired = vi.fn();
    store.startReaper(50, onExpired);

    // Advance time past expiry
    time = 2000;
    await new Promise((r) => setTimeout(r, 150));

    expect(onExpired).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ leaseId: lease.leaseId })]),
    );
    expect(store.size).toBe(0);
  });

  it("idempotency: expired key allows re-acquire", () => {
    let time = 1000;
    setNow(() => time);

    const lease1 = makeLease({ idempotencyKey: "reuse", expiresAt: 1500 });
    store.add(lease1);

    // Expire it
    time = 2000;
    store.sweep();

    // Same idempotency key should be free now
    expect(store.getByIdempotencyKey("reuse")).toBeUndefined();

    // Can add a new lease with the same key
    const lease2 = makeLease({ idempotencyKey: "reuse", expiresAt: 3000 });
    store.add(lease2);
    expect(store.getByIdempotencyKey("reuse")?.leaseId).toBe(lease2.leaseId);
  });
});
