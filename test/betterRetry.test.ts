import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConcurrencyPool } from "../src/pools/concurrency.js";
import { RatePool } from "../src/pools/rate.js";
import { Governor } from "../src/governor.js";
import { setNow, resetNow } from "../src/utils/time.js";
import { RETRY_MIN_MS, RETRY_MAX_MS } from "../src/utils/retry.js";

describe("ConcurrencyPool — computed retryAfter", () => {
  it("uses earliestExpiryMs when provided", () => {
    const pool = new ConcurrencyPool({ maxInFlight: 1 });
    pool.tryAcquire("interactive");

    // Deny with explicit earliest expiry: 2s away
    const result = pool.tryAcquire("interactive", 2_000);
    expect(result.ok).toBe(false);
    expect(result.retryAfterMs).toBe(2_000);
  });

  it("clamps earliestExpiryMs to bounds", () => {
    const pool = new ConcurrencyPool({ maxInFlight: 1 });
    pool.tryAcquire("interactive");

    // Very small expiry → clamped to min
    const tooSmall = pool.tryAcquire("interactive", 5);
    expect(tooSmall.retryAfterMs).toBe(RETRY_MIN_MS);

    // Very large expiry → clamped to max
    const tooLarge = pool.tryAcquire("interactive", 60_000);
    expect(tooLarge.retryAfterMs).toBe(RETRY_MAX_MS);
  });

  it("falls back to heuristic when earliestExpiryMs is undefined", () => {
    const pool = new ConcurrencyPool({ maxInFlight: 1 });
    pool.tryAcquire("interactive");

    const result = pool.tryAcquire("interactive");
    expect(result.ok).toBe(false);
    // Heuristic: 250 + pressure * 750, pressure=1 → 1000, clamped ≤ 5000
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(RETRY_MIN_MS);
    expect(result.retryAfterMs).toBeLessThanOrEqual(RETRY_MAX_MS);
  });

  it("falls back to heuristic when earliestExpiryMs is zero or negative", () => {
    const pool = new ConcurrencyPool({ maxInFlight: 1 });
    pool.tryAcquire("interactive");

    // Zero → fallback
    const zero = pool.tryAcquire("interactive", 0);
    expect(zero.retryAfterMs).toBeGreaterThanOrEqual(RETRY_MIN_MS);

    // Negative → fallback
    const negative = pool.tryAcquire("interactive", -100);
    expect(negative.retryAfterMs).toBeGreaterThanOrEqual(RETRY_MIN_MS);
  });
});

describe("RatePool — clamped retryAfter", () => {
  let time: number;

  beforeEach(() => {
    time = 100_000;
    setNow(() => time);
  });

  afterEach(() => {
    resetNow();
  });

  it("clamps retryAfterMs to bounds", () => {
    // Window of 10s, rate limit 1
    const pool = new RatePool({ requestsPerMinute: 1, windowMs: 10_000 });
    pool.tryAcquire();
    pool.record(); // at 100_000

    // Immediately retry → raw retryAfterMs ≈ 10_000 → clamped to 5_000
    const denied = pool.tryAcquire();
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterMs).toBe(RETRY_MAX_MS);
  });

  it("returns unclamped value when within bounds", () => {
    const pool = new RatePool({ requestsPerMinute: 1, windowMs: 10_000 });
    pool.tryAcquire();
    pool.record(); // at 100_000

    // Advance close to window expiry: only 2s remaining
    time = 108_000;
    const denied = pool.tryAcquire();
    expect(denied.ok).toBe(false);
    // raw = 100_000 + 10_000 - 108_000 = 2_000
    expect(denied.retryAfterMs).toBe(2_000);
  });
});

describe("Governor — computed retryAfter integration", () => {
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

  it("concurrency denial retryAfterMs reflects earliest lease expiry", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 1 },
      leaseTtlMs: 3_000,
      reaperIntervalMs: 100_000,
    });

    // Lease issued at time=10_000, expires at 13_000
    const d1 = gov.acquire({ actorId: "a", action: "chat" });
    expect(d1.granted).toBe(true);

    // Advance 1s → earliest expiry is 2s away
    time = 11_000;

    const denied = gov.acquire({ actorId: "b", action: "chat" });
    expect(denied.granted).toBe(false);
    if (denied.granted) return;

    expect(denied.reason).toBe("concurrency");
    // earliestExpiry = 13_000, now = 11_000, diff = 2_000
    expect(denied.retryAfterMs).toBe(2_000);
  });

  it("retryAfterMs is clamped even for very short TTLs", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 1 },
      leaseTtlMs: 10, // Very short TTL
      reaperIntervalMs: 100_000,
    });

    gov.acquire({ actorId: "a", action: "chat" });

    // Advance 5ms → only 5ms until expiry → clamped to 25ms
    time = 10_005;
    const denied = gov.acquire({ actorId: "b", action: "chat" });
    expect(denied.granted).toBe(false);
    if (denied.granted) return;

    expect(denied.retryAfterMs).toBe(RETRY_MIN_MS);
  });

  it("retryAfterMs is clamped for very long TTLs", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 1 },
      leaseTtlMs: 120_000, // 2 minutes
      reaperIntervalMs: 100_000,
    });

    gov.acquire({ actorId: "a", action: "chat" });

    const denied = gov.acquire({ actorId: "b", action: "chat" });
    expect(denied.granted).toBe(false);
    if (denied.granted) return;

    // Raw expiry diff = 120_000 → clamped to 5_000
    expect(denied.retryAfterMs).toBe(RETRY_MAX_MS);
  });

  it("rate denial retryAfterMs is clamped", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 10 },
      rate: { requestsPerMinute: 1, windowMs: 60_000 },
      leaseTtlMs: 60_000,
    });

    gov.acquire({ actorId: "a", action: "chat" });

    // Immediately retry → raw retryAfterMs ≈ 60_000 → clamped to 5_000
    const denied = gov.acquire({ actorId: "a", action: "chat" });
    expect(denied.granted).toBe(false);
    if (denied.granted) return;

    expect(denied.reason).toBe("rate");
    expect(denied.retryAfterMs).toBe(RETRY_MAX_MS);
  });
});
