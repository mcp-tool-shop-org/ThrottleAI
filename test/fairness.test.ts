import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FairnessTracker } from "../src/fairness.js";
import { Governor } from "../src/governor.js";
import { setNow, resetNow } from "../src/utils/time.js";

describe("FairnessTracker", () => {
  let time: number;

  beforeEach(() => {
    time = 10_000;
    setNow(() => time);
  });

  afterEach(() => {
    resetNow();
  });

  it("allows when pool is under 50% utilized", () => {
    const tracker = new FairnessTracker({ softCapRatio: 0.6 });

    // Actor holds 8 of 10 weight, but pool is only 40% utilized
    tracker.recordAcquire("alice", 8);
    // Pool is at 4 of 10 (40%) → no enforcement
    const result = tracker.check("alice", 1, 10, 4);
    expect(result).toBe(true);
  });

  it("blocks actor exceeding soft cap when pool under pressure", () => {
    const tracker = new FairnessTracker({ softCapRatio: 0.6 });

    // Alice holds 6 of 10 weight (= 60% cap)
    tracker.recordAcquire("alice", 6);
    // Pool is at 7 of 10 (70% → under pressure)
    // Alice at 6 + 1 = 7 > 6 (60% of 10) → blocked
    const result = tracker.check("alice", 1, 10, 7);
    expect(result).toBe(false);
  });

  it("allows different actor even when pool under pressure", () => {
    const tracker = new FairnessTracker({ softCapRatio: 0.6 });

    // Alice holds 6 of 10
    tracker.recordAcquire("alice", 6);
    // Pool is at 7 of 10 (under pressure)
    // Bob holds 0, 0 + 1 = 1 ≤ 6 → allowed
    const result = tracker.check("bob", 1, 10, 7);
    expect(result).toBe(true);
  });

  it("anti-starvation: recently denied actor gets a pass", () => {
    const tracker = new FairnessTracker({
      softCapRatio: 0.6,
      starvationWindowMs: 5_000,
    });

    // Alice holds 6 of 10 and gets denied
    tracker.recordAcquire("alice", 6);
    tracker.recordDenial("alice");

    // Pool under pressure: 7 of 10
    // Normally would be blocked, but has a starvation pass
    const result = tracker.check("alice", 1, 10, 7);
    expect(result).toBe(true);

    // Pass is consumed — second check should be blocked
    const result2 = tracker.check("alice", 1, 10, 7);
    expect(result2).toBe(false);
  });

  it("starvation pass expires after window", () => {
    const tracker = new FairnessTracker({
      softCapRatio: 0.6,
      starvationWindowMs: 5_000,
    });

    tracker.recordAcquire("alice", 6);
    tracker.recordDenial("alice");

    // Advance past starvation window
    time = 16_000;

    // Pool under pressure: 7 of 10
    const result = tracker.check("alice", 1, 10, 7);
    expect(result).toBe(false); // Pass expired
  });

  it("release decrements actor weight", () => {
    const tracker = new FairnessTracker({ softCapRatio: 0.6 });

    tracker.recordAcquire("alice", 5);
    expect(tracker.actorWeight("alice")).toBe(5);

    tracker.recordRelease("alice", 3);
    expect(tracker.actorWeight("alice")).toBe(2);

    tracker.recordRelease("alice", 2);
    expect(tracker.actorWeight("alice")).toBe(0);
  });

  it("release never goes below 0", () => {
    const tracker = new FairnessTracker();
    tracker.recordRelease("alice", 10);
    expect(tracker.actorWeight("alice")).toBe(0);
  });

  it("prune removes stale denial entries", () => {
    const tracker = new FairnessTracker({ starvationWindowMs: 5_000 });

    tracker.recordDenial("alice");
    time = 20_000; // Well past window
    tracker.prune();

    // Record acquire to put alice over cap
    tracker.recordAcquire("alice", 6);
    // No starvation pass should exist
    const result = tracker.check("alice", 1, 10, 7);
    expect(result).toBe(false);
  });
});

describe("Governor — fairness integration", () => {
  let gov: Governor;
  let time: number;

  beforeEach(() => {
    time = 10_000;
    setNow(() => time);
  });

  afterEach(() => {
    gov?.dispose();
    resetNow();
  });

  it("soft cap denies actor exceeding fair share with reason policy", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 10 },
      fairness: { softCapRatio: 0.5 },
      leaseTtlMs: 60_000,
    });

    // Alice takes 5 leases (weight 1 each) → 50% of capacity
    const leaseIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = gov.acquire({ actorId: "alice", action: "chat" });
      expect(d.granted).toBe(true);
      if (d.granted) leaseIds.push(d.leaseId);
    }
    expect(gov.concurrencyActive).toBe(5);

    // Alice tries one more → 6 > 5 (50% of 10) → denied with reason "policy"
    const denied = gov.acquire({ actorId: "alice", action: "chat" });
    expect(denied.granted).toBe(false);
    if (!denied.granted) {
      expect(denied.reason).toBe("policy");
      expect(denied.recommendation).toContain("fair share");
    }
  });

  it("fairness does not block other actors", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 10 },
      fairness: { softCapRatio: 0.5 },
      leaseTtlMs: 60_000,
    });

    // Alice takes 5 leases
    for (let i = 0; i < 5; i++) {
      gov.acquire({ actorId: "alice", action: "chat" });
    }

    // Bob should be able to acquire
    const bobD = gov.acquire({ actorId: "bob", action: "chat" });
    expect(bobD.granted).toBe(true);
  });

  it("fairness disabled by default", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 10 },
      leaseTtlMs: 60_000,
    });

    // Alice takes 9 leases — no fairness check
    for (let i = 0; i < 9; i++) {
      const d = gov.acquire({ actorId: "alice", action: "chat" });
      expect(d.granted).toBe(true);
    }
    // 10th should succeed (no fairness)
    const d10 = gov.acquire({ actorId: "alice", action: "chat" });
    expect(d10.granted).toBe(true);
  });

  it("fairness: true enables with defaults", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 10 },
      fairness: true,
      leaseTtlMs: 60_000,
    });

    // Alice takes 6 leases (= 60% default cap) → pool is at 60% utilization
    for (let i = 0; i < 6; i++) {
      gov.acquire({ actorId: "alice", action: "chat" });
    }

    // 7th from alice → 7 > 6 (60% of 10), pool at 60% (> 50% threshold) → denied
    const denied = gov.acquire({ actorId: "alice", action: "chat" });
    expect(denied.granted).toBe(false);
    if (!denied.granted) {
      expect(denied.reason).toBe("policy");
    }
  });

  it("fairness not enforced when pool utilization is low", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 20 },
      fairness: { softCapRatio: 0.5 },
      leaseTtlMs: 60_000,
    });

    // Alice takes 9 leases, but pool is only at 45% (9/20) → no enforcement
    for (let i = 0; i < 9; i++) {
      const d = gov.acquire({ actorId: "alice", action: "chat" });
      expect(d.granted).toBe(true);
    }
    // 10th still ok because pool is under 50% pressure
    const d10 = gov.acquire({ actorId: "alice", action: "chat" });
    expect(d10.granted).toBe(true);
  });

  it("release updates fairness tracking", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 10 },
      fairness: { softCapRatio: 0.5 },
      leaseTtlMs: 60_000,
    });

    // Alice takes 5 leases → at cap
    const leaseIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = gov.acquire({ actorId: "alice", action: "chat" });
      if (d.granted) leaseIds.push(d.leaseId);
    }

    // Denied
    expect(gov.acquire({ actorId: "alice", action: "chat" }).granted).toBe(false);

    // Release 2
    gov.release(leaseIds[0], { outcome: "success" });
    gov.release(leaseIds[1], { outcome: "success" });

    // Now alice holds 3, cap is 5 → should succeed
    // But pool is at 3/10 = 30% → under 50%, so fairness doesn't even apply
    const d = gov.acquire({ actorId: "alice", action: "chat" });
    expect(d.granted).toBe(true);
  });

  it("fairness policy denial does not leak concurrency token", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 10 },
      fairness: { softCapRatio: 0.5 },
      leaseTtlMs: 60_000,
    });

    // Fill to trigger pressure
    for (let i = 0; i < 5; i++) {
      gov.acquire({ actorId: "alice", action: "chat" });
    }

    const before = gov.concurrencyActive;
    // This should be policy-denied
    const denied = gov.acquire({ actorId: "alice", action: "chat" });
    expect(denied.granted).toBe(false);
    // Concurrency should not have changed
    expect(gov.concurrencyActive).toBe(before);
  });

  it("weighted fairness: heavy actor soft-capped", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 10 },
      fairness: { softCapRatio: 0.5 },
      leaseTtlMs: 60_000,
    });

    // Alice takes weight-5 lease (= 50% of 10, at cap)
    gov.acquire({
      actorId: "alice",
      action: "chat",
      estimate: { weight: 5 },
    });
    expect(gov.concurrencyActive).toBe(5);

    // Alice tries weight-1 → 6 > 5 (50% cap), pool at 50% → denied
    const denied = gov.acquire({ actorId: "alice", action: "chat" });
    expect(denied.granted).toBe(false);
    if (!denied.granted) {
      expect(denied.reason).toBe("policy");
    }

    // Bob with weight-5 → fine
    const bobD = gov.acquire({
      actorId: "bob",
      action: "chat",
      estimate: { weight: 5 },
    });
    expect(bobD.granted).toBe(true);
  });
});
