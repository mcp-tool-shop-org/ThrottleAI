import { describe, it, expect, afterEach } from "vitest";
import { Governor } from "../src/governor.js";
import { setNow, resetNow, createTestClock } from "../src/utils/time.js";

describe("TTL expiry + manual release ordering", () => {
  let gov: Governor;

  afterEach(() => {
    gov?.dispose();
    resetNow();
  });

  it("manual release before TTL expiry works normally", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 1_000, reaperIntervalMs: 100_000 });
    const d = gov.acquire({ actorId: "a", action: "chat" });
    expect(d.granted).toBe(true);
    if (!d.granted) return;

    clock.advance(500); // half of TTL
    gov.release(d.leaseId, { outcome: "success" });

    expect(gov.concurrencyAvailable).toBe(1);
    expect(gov.activeLeases).toBe(0);
  });

  it("release after TTL has passed is a no-op (lease already reaped)", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 1_000, reaperIntervalMs: 100_000 });
    const d = gov.acquire({ actorId: "a", action: "chat" });
    expect(d.granted).toBe(true);
    if (!d.granted) return;

    clock.advance(2_000); // well past TTL

    // Manually trigger reaper by acquiring (reaper is interval-based, so we simulate)
    // The lease is expired but not yet reaped. Manual release should still work
    // because the store still has it.
    gov.release(d.leaseId, { outcome: "timeout" });

    // Lease is gone — slot is available
    expect(gov.activeLeases).toBe(0);
  });

  it("non-strict: double release is silent no-op", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    gov = new Governor({ concurrency: { maxInFlight: 2 }, leaseTtlMs: 60_000 });
    const d = gov.acquire({ actorId: "a", action: "chat" });
    expect(d.granted).toBe(true);
    if (!d.granted) return;

    gov.release(d.leaseId, { outcome: "success" });
    // Second release — no-op, no throw
    gov.release(d.leaseId, { outcome: "success" });

    expect(gov.concurrencyAvailable).toBe(2);
  });

  it("strict: double release throws", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    gov = new Governor({ concurrency: { maxInFlight: 2 }, leaseTtlMs: 60_000, strict: true });
    const d = gov.acquire({ actorId: "a", action: "chat" });
    expect(d.granted).toBe(true);
    if (!d.granted) return;

    gov.release(d.leaseId, { outcome: "success" });

    expect(() => gov.release(d.leaseId, { outcome: "success" })).toThrow("Double release");
  });

  it("strict: unknown leaseId throws", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    gov = new Governor({ concurrency: { maxInFlight: 2 }, leaseTtlMs: 60_000, strict: true });

    expect(() => gov.release("nonexistent-id", { outcome: "success" })).toThrow("Unknown lease");
  });
});

describe("rate window boundary conditions", () => {
  afterEach(() => {
    resetNow();
  });

  it("exactly at rate limit denies the next request", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    const gov = new Governor({ rate: { requestsPerMinute: 3, windowMs: 60_000 }, leaseTtlMs: 60_000 });

    // Fill to exactly the limit
    expect(gov.acquire({ actorId: "a", action: "chat" }).granted).toBe(true);
    expect(gov.acquire({ actorId: "a", action: "chat" }).granted).toBe(true);
    expect(gov.acquire({ actorId: "a", action: "chat" }).granted).toBe(true);

    // Exactly at limit — next should be denied
    const d = gov.acquire({ actorId: "a", action: "chat" });
    expect(d.granted).toBe(false);

    gov.dispose();
  });

  it("window slides: old entries expire, new ones allowed", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    const gov = new Governor({ rate: { requestsPerMinute: 2, windowMs: 1_000 }, leaseTtlMs: 60_000 });

    expect(gov.acquire({ actorId: "a", action: "chat" }).granted).toBe(true);
    expect(gov.acquire({ actorId: "a", action: "chat" }).granted).toBe(true);
    expect(gov.acquire({ actorId: "a", action: "chat" }).granted).toBe(false);

    // Advance past window
    clock.advance(1_100);

    // Old entries should have expired
    expect(gov.acquire({ actorId: "a", action: "chat" }).granted).toBe(true);

    gov.dispose();
  });

  it("rate deny retryAfterMs is accurate", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    const gov = new Governor({ rate: { requestsPerMinute: 1, windowMs: 1_000 }, leaseTtlMs: 60_000 });

    expect(gov.acquire({ actorId: "a", action: "chat" }).granted).toBe(true);

    clock.advance(300); // 300ms into window

    const d = gov.acquire({ actorId: "a", action: "chat" });
    expect(d.granted).toBe(false);
    if (!d.granted) {
      // retryAfter should be roughly 700ms (remaining window)
      expect(d.retryAfterMs).toBeGreaterThan(0);
      expect(d.retryAfterMs).toBeLessThanOrEqual(1_000);
    }

    gov.dispose();
  });
});

describe("concurrency + rate combined edge cases", () => {
  afterEach(() => {
    resetNow();
  });

  it("concurrency grants but rate denies → concurrency slot restored", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 5 },
      rate: { requestsPerMinute: 1, windowMs: 60_000 },
      leaseTtlMs: 60_000,
    });

    // First request: passes both
    const d1 = gov.acquire({ actorId: "a", action: "chat" });
    expect(d1.granted).toBe(true);
    expect(gov.concurrencyActive).toBe(1);

    // Second request: concurrency ok, rate denies → concurrency should be rolled back
    const d2 = gov.acquire({ actorId: "a", action: "chat" });
    expect(d2.granted).toBe(false);
    // Concurrency active should still be 1 (not 2)
    expect(gov.concurrencyActive).toBe(1);

    gov.dispose();
  });

  it("interactive reserve works correctly at boundary", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 3, interactiveReserve: 1 },
      leaseTtlMs: 60_000,
    });

    // Fill 2 of 3 slots with background
    expect(gov.acquire({ actorId: "a", action: "bg", priority: "background" }).granted).toBe(true);
    expect(gov.acquire({ actorId: "a", action: "bg", priority: "background" }).granted).toBe(true);

    // 3rd slot is reserve — background denied
    expect(gov.acquire({ actorId: "a", action: "bg", priority: "background" }).granted).toBe(false);

    // Interactive can use reserve
    expect(gov.acquire({ actorId: "a", action: "ui", priority: "interactive" }).granted).toBe(true);

    gov.dispose();
  });
});

describe("createTestClock utility", () => {
  afterEach(() => {
    resetNow();
  });

  it("starts at specified time", () => {
    const clock = createTestClock(42_000);
    setNow(clock.fn);
    expect(clock.fn()).toBe(42_000);
  });

  it("advance moves time forward", () => {
    const clock = createTestClock(0);
    setNow(clock.fn);
    clock.advance(100);
    expect(clock.fn()).toBe(100);
    clock.advance(50);
    expect(clock.fn()).toBe(150);
  });

  it("direct time mutation works", () => {
    const clock = createTestClock(1_000);
    setNow(clock.fn);
    clock.time = 5_000;
    expect(clock.fn()).toBe(5_000);
  });
});
