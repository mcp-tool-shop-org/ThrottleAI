import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AdaptiveController } from "../src/adaptive.js";
import { Governor } from "../src/governor.js";
import { setNow, resetNow } from "../src/utils/time.js";

describe("AdaptiveController", () => {
  it("starts at maxConcurrency", () => {
    const ctrl = new AdaptiveController(10);
    expect(ctrl.effectiveConcurrency).toBe(10);
  });

  it("reduces concurrency when deny rate exceeds target", () => {
    const ctrl = new AdaptiveController(10, {
      targetDenyRate: 0.05,
      adjustIntervalMs: 100,
      alpha: 1.0, // instant response for testing
    });

    let time = 1_000;

    // Initialize
    ctrl.maybeAdjust(time);
    time += 100;

    // Simulate high deny rate: 20 denials, 80 acquires
    for (let i = 0; i < 80; i++) ctrl.recordAcquire();
    for (let i = 0; i < 20; i++) ctrl.recordDenial();

    ctrl.maybeAdjust(time);
    expect(ctrl.effectiveConcurrency).toBe(9); // Reduced by 1
  });

  it("increases concurrency when healthy", () => {
    const ctrl = new AdaptiveController(10, {
      targetDenyRate: 0.05,
      adjustIntervalMs: 100,
      alpha: 1.0,
      minConcurrency: 5,
    });

    // Start below max
    let time = 1_000;
    ctrl.maybeAdjust(time);
    time += 100;

    // First: force a reduction to get below max
    for (let i = 0; i < 80; i++) ctrl.recordAcquire();
    for (let i = 0; i < 20; i++) ctrl.recordDenial();
    ctrl.maybeAdjust(time);
    expect(ctrl.effectiveConcurrency).toBe(9);
    time += 100;

    // Now: very healthy — 0% deny rate, no latency issues
    for (let i = 0; i < 100; i++) ctrl.recordAcquire();
    ctrl.maybeAdjust(time);
    expect(ctrl.effectiveConcurrency).toBe(10); // Back to max
  });

  it("never goes below minConcurrency", () => {
    const ctrl = new AdaptiveController(10, {
      targetDenyRate: 0.01,
      adjustIntervalMs: 100,
      alpha: 1.0,
      minConcurrency: 3,
    });

    let time = 1_000;
    ctrl.maybeAdjust(time);

    // Keep driving deny rate up for many intervals
    for (let round = 0; round < 20; round++) {
      time += 100;
      for (let i = 0; i < 10; i++) ctrl.recordAcquire();
      for (let i = 0; i < 90; i++) ctrl.recordDenial();
      ctrl.maybeAdjust(time);
    }

    expect(ctrl.effectiveConcurrency).toBeGreaterThanOrEqual(3);
  });

  it("never exceeds maxConcurrency", () => {
    const ctrl = new AdaptiveController(5, {
      adjustIntervalMs: 100,
      alpha: 1.0,
    });

    let time = 1_000;
    ctrl.maybeAdjust(time);

    // Keep driving healthy for many intervals
    for (let round = 0; round < 20; round++) {
      time += 100;
      for (let i = 0; i < 100; i++) ctrl.recordAcquire();
      ctrl.maybeAdjust(time);
    }

    expect(ctrl.effectiveConcurrency).toBe(5);
  });

  it("reduces when latency climbs above threshold", () => {
    const ctrl = new AdaptiveController(10, {
      targetDenyRate: 1.0, // Very high target → deny rate won't trigger
      latencyThreshold: 1.5,
      adjustIntervalMs: 100,
      alpha: 1.0,
    });

    let time = 1_000;
    ctrl.maybeAdjust(time);
    time += 100;

    // Establish baseline: 100ms latency
    for (let i = 0; i < 10; i++) ctrl.recordLatency(100);
    for (let i = 0; i < 10; i++) ctrl.recordAcquire();
    ctrl.maybeAdjust(time);
    expect(ctrl.effectiveConcurrency).toBe(10); // Baseline established
    time += 100;

    // Latency spikes to 200ms (2x baseline, > 1.5x threshold)
    for (let i = 0; i < 10; i++) ctrl.recordLatency(200);
    for (let i = 0; i < 10; i++) ctrl.recordAcquire();
    ctrl.maybeAdjust(time);
    expect(ctrl.effectiveConcurrency).toBe(9); // Reduced
  });

  it("does not adjust before adjustIntervalMs", () => {
    const ctrl = new AdaptiveController(10, {
      adjustIntervalMs: 5_000,
      alpha: 1.0,
    });

    ctrl.maybeAdjust(1_000); // Initialize

    // Record lots of denials
    for (let i = 0; i < 50; i++) ctrl.recordDenial();

    // Not enough time has passed
    ctrl.maybeAdjust(3_000);
    expect(ctrl.effectiveConcurrency).toBe(10); // No change yet

    // Now enough time
    ctrl.maybeAdjust(6_001);
    expect(ctrl.effectiveConcurrency).toBe(9); // Adjusted
  });
});

describe("Governor — adaptive integration", () => {
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

  it("adaptive: true enables adaptive controller with defaults", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 5 },
      adaptive: true,
      leaseTtlMs: 60_000,
    });

    // Should start with full concurrency
    expect(gov.concurrencyEffectiveMax).toBe(5);
  });

  it("adaptive reduces effective concurrency on high deny rate", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 5 },
      adaptive: {
        adjustIntervalMs: 100,
        alpha: 1.0,
        targetDenyRate: 0.05,
      },
      leaseTtlMs: 60_000,
    });

    // Fill all slots
    const leaseIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = gov.acquire({ actorId: `u${i}`, action: "chat" });
      if (d.granted) leaseIds.push(d.leaseId);
    }

    // Generate denials (triggers adaptive denial tracking)
    for (let i = 0; i < 20; i++) {
      gov.acquire({ actorId: "denied", action: "chat" });
    }

    // Advance time past adjust interval
    time += 200;

    // Next acquire triggers maybeAdjust
    gov.acquire({ actorId: "trigger", action: "chat" });

    // Effective max should have decreased
    expect(gov.concurrencyEffectiveMax).toBeLessThan(5);
  });

  it("latencyMs in release feeds adaptive controller", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 10 },
      adaptive: {
        adjustIntervalMs: 100,
        alpha: 1.0,
        latencyThreshold: 1.5,
        targetDenyRate: 1.0, // Disable deny-based reduction
      },
      leaseTtlMs: 60_000,
    });

    // Establish baseline latency
    const d1 = gov.acquire({ actorId: "a", action: "chat" });
    if (d1.granted) {
      gov.release(d1.leaseId, { outcome: "success", latencyMs: 100 });
    }

    time += 150;
    // Trigger adjustment (baseline = 100ms)
    gov.acquire({ actorId: "trigger", action: "chat" });

    expect(gov.concurrencyEffectiveMax).toBe(10); // Stable

    time += 150;
    // Now spike latency
    const d2 = gov.acquire({ actorId: "a", action: "chat" });
    if (d2.granted) {
      gov.release(d2.leaseId, { outcome: "success", latencyMs: 300 });
    }

    time += 150;
    gov.acquire({ actorId: "trigger2", action: "chat" });

    expect(gov.concurrencyEffectiveMax).toBeLessThan(10); // Reduced
  });

  it("adaptive disabled by default", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 5 },
      leaseTtlMs: 60_000,
    });

    // Fill and deny many times
    for (let i = 0; i < 5; i++) {
      gov.acquire({ actorId: `u${i}`, action: "chat" });
    }
    for (let i = 0; i < 50; i++) {
      gov.acquire({ actorId: "denied", action: "chat" });
    }

    time += 10_000;
    gov.acquire({ actorId: "test", action: "chat" });

    // No adaptive → effective max equals configured max
    expect(gov.concurrencyEffectiveMax).toBe(5);
  });

  it("adaptive not active without concurrency config", () => {
    gov = new Governor({
      adaptive: true,
      leaseTtlMs: 60_000,
    });

    // Should not crash, effective max is Infinity (no pool)
    expect(gov.concurrencyEffectiveMax).toBe(Infinity);
  });
});
