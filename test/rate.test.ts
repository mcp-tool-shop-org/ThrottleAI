import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RatePool } from "../src/pools/rate.js";
import { Governor } from "../src/governor.js";
import { setNow, resetNow } from "../src/utils/time.js";
import { RETRY_MAX_MS } from "../src/utils/retry.js";

describe("RatePool", () => {
  let time: number;

  beforeEach(() => {
    time = 100_000;
    setNow(() => time);
  });

  afterEach(() => {
    resetNow();
  });

  it("allows up to requestsPerMinute within window", () => {
    const pool = new RatePool({ requestsPerMinute: 3, windowMs: 60_000 });

    for (let i = 0; i < 3; i++) {
      const r = pool.tryAcquire();
      expect(r.ok).toBe(true);
      pool.record();
    }

    expect(pool.currentCount).toBe(3);
  });

  it("denies excess with retryAfterMs", () => {
    const pool = new RatePool({ requestsPerMinute: 2, windowMs: 60_000 });

    pool.tryAcquire();
    pool.record();
    time += 1_000;

    pool.tryAcquire();
    pool.record();

    const denied = pool.tryAcquire();
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe("rate");
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    // retryAfterMs raw = 100_000 + 60_000 - 101_000 = 59_000
    // but clamped to RETRY_MAX_MS (5_000)
    expect(denied.retryAfterMs).toBe(RETRY_MAX_MS);
  });

  it("window slides: old entries expire, new ones allowed", () => {
    const pool = new RatePool({ requestsPerMinute: 2, windowMs: 10_000 });

    pool.tryAcquire();
    pool.record(); // at 100_000

    time += 1_000;
    pool.tryAcquire();
    pool.record(); // at 101_000

    // Full — should deny
    expect(pool.tryAcquire().ok).toBe(false);

    // Advance past first entry's window
    time = 110_001;
    expect(pool.tryAcquire().ok).toBe(true);
    pool.record();
    expect(pool.currentCount).toBe(2); // second original + new
  });

  it("burst followed by steady-state recovers", () => {
    const pool = new RatePool({ requestsPerMinute: 3, windowMs: 10_000 });

    // Burst: fill all 3
    for (let i = 0; i < 3; i++) {
      pool.tryAcquire();
      pool.record();
      time += 100;
    }

    expect(pool.tryAcquire().ok).toBe(false);

    // Wait for window to expire all entries
    time += 10_000;
    expect(pool.currentCount).toBe(0);

    // Steady-state: should be fully available
    expect(pool.tryAcquire().ok).toBe(true);
    pool.record();
    expect(pool.currentCount).toBe(1);
  });
});

describe("Governor with rate pool", () => {
  let gov: Governor;
  let time: number;

  beforeEach(() => {
    time = 100_000;
    setNow(() => time);
  });

  afterEach(() => {
    gov?.dispose();
    resetNow();
  });

  it("denies with reason rate when rate limit exceeded", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 10 },
      rate: { requestsPerMinute: 2, windowMs: 10_000 },
      leaseTtlMs: 60_000,
    });

    gov.acquire({ actorId: "a", action: "chat" });
    gov.acquire({ actorId: "a", action: "chat" });

    const denied = gov.acquire({ actorId: "a", action: "chat" });
    expect(denied.granted).toBe(false);
    if (denied.granted) return;

    expect(denied.reason).toBe("rate");
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("rate denial does not consume concurrency slot", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 10 },
      rate: { requestsPerMinute: 1, windowMs: 10_000 },
      leaseTtlMs: 60_000,
    });

    gov.acquire({ actorId: "a", action: "chat" });
    expect(gov.concurrencyActive).toBe(1);

    // Rate-denied
    const denied = gov.acquire({ actorId: "a", action: "chat" });
    expect(denied.granted).toBe(false);
    // Should not have leaked a concurrency token
    expect(gov.concurrencyActive).toBe(1);
  });

  it("rate status getters", () => {
    gov = new Governor({
      rate: { requestsPerMinute: 5, windowMs: 10_000 },
      leaseTtlMs: 60_000,
    });

    expect(gov.rateCount).toBe(0);
    expect(gov.rateLimit).toBe(5);

    gov.acquire({ actorId: "a", action: "chat" });
    expect(gov.rateCount).toBe(1);
  });
});
