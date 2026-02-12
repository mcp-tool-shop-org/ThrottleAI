import { describe, it, expect } from "vitest";
import { ConcurrencyPool } from "../src/pools/concurrency.js";

describe("ConcurrencyPool", () => {
  it("grants up to maxInFlight", () => {
    const pool = new ConcurrencyPool({ maxInFlight: 3 });

    expect(pool.tryAcquire("interactive").ok).toBe(true);
    expect(pool.tryAcquire("interactive").ok).toBe(true);
    expect(pool.tryAcquire("interactive").ok).toBe(true);
    expect(pool.active).toBe(3);
  });

  it("denies at capacity with reason concurrency", () => {
    const pool = new ConcurrencyPool({ maxInFlight: 1 });
    pool.tryAcquire("interactive");

    const result = pool.tryAcquire("interactive");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("concurrency");
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("release returns capacity", () => {
    const pool = new ConcurrencyPool({ maxInFlight: 1 });
    pool.tryAcquire("interactive");
    expect(pool.available).toBe(0);

    pool.release();
    expect(pool.available).toBe(1);
    expect(pool.tryAcquire("interactive").ok).toBe(true);
  });

  it("interactive reserve: background blocked when only reserve remains", () => {
    const pool = new ConcurrencyPool({ maxInFlight: 3, interactiveReserve: 1 });

    // Fill 2 of 3 slots
    pool.tryAcquire("background");
    pool.tryAcquire("background");
    expect(pool.available).toBe(1);

    // Only 1 slot left = the reserve — background should be blocked
    const bgResult = pool.tryAcquire("background");
    expect(bgResult.ok).toBe(false);
    expect(bgResult.reason).toBe("concurrency");
  });

  it("interactive can use the reserve", () => {
    const pool = new ConcurrencyPool({ maxInFlight: 3, interactiveReserve: 1 });

    pool.tryAcquire("background");
    pool.tryAcquire("background");

    // Interactive should get the last slot (reserved)
    const result = pool.tryAcquire("interactive");
    expect(result.ok).toBe(true);
    expect(pool.active).toBe(3);
  });

  it("release never goes below 0", () => {
    const pool = new ConcurrencyPool({ maxInFlight: 2 });
    pool.release();
    pool.release();
    expect(pool.active).toBe(0);
  });

  it("throws if reserve >= maxInFlight", () => {
    expect(() => new ConcurrencyPool({ maxInFlight: 2, interactiveReserve: 2 })).toThrow();
    expect(() => new ConcurrencyPool({ maxInFlight: 2, interactiveReserve: 3 })).toThrow();
  });
});
