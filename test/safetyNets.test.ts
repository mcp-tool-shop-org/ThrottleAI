/**
 * Safety-net tests for gaps identified during Phase 4 audit.
 *
 * Covers:
 *   1. Reaper-driven TTL expiry releasing concurrency capacity
 *   2. onEvent callback throws doesn't crash governor
 *   3. dispose() then acquire() behavior
 *   4. Concurrent parallel acquire/release (Promise.all)
 */

import { describe, it, expect, afterEach } from "vitest";
import { Governor } from "../src/governor.js";
import { setNow, resetNow, createTestClock } from "../src/utils/time.js";

// ---------------------------------------------------------------------------
// 1. Reaper-driven TTL expiry actually releases capacity
// ---------------------------------------------------------------------------

describe("reaper TTL expiry", () => {
  afterEach(() => {
    resetNow();
  });

  it("real reaper frees capacity after lease TTL", async () => {
    const clock = createTestClock(10_000);
    setNow(clock.fn);

    // Short TTL + fast reaper so the test doesn't take forever
    const gov = new Governor({
      concurrency: { maxInFlight: 1 },
      leaseTtlMs: 100,
      reaperIntervalMs: 50, // real interval, not disabled
    });

    try {
      const d1 = gov.acquire({ actorId: "a", action: "chat" });
      expect(d1.granted).toBe(true);
      expect(gov.concurrencyActive).toBe(1);

      // Slot is full
      const d2 = gov.acquire({ actorId: "b", action: "chat" });
      expect(d2.granted).toBe(false);

      // Advance past TTL
      clock.advance(150);

      // Wait for the real setInterval reaper to fire.
      // The reaper uses setInterval (real timer), but our clock is fake.
      // The reaper's _sweep() uses now() which reads our fake clock.
      // So we just need the interval to fire — wait a bit of real time.
      await new Promise((r) => setTimeout(r, 120));

      // After reaper fires, capacity should be freed
      expect(gov.concurrencyActive).toBe(0);
      expect(gov.activeLeases).toBe(0);

      // New acquire should succeed
      const d3 = gov.acquire({ actorId: "c", action: "chat" });
      expect(d3.granted).toBe(true);
    } finally {
      gov.dispose();
    }
  });

  it("reaper emits expire events", async () => {
    const clock = createTestClock(10_000);
    setNow(clock.fn);
    const events: string[] = [];

    const gov = new Governor({
      concurrency: { maxInFlight: 2 },
      leaseTtlMs: 100,
      reaperIntervalMs: 50,
      onEvent: (e) => events.push(e.type),
    });

    try {
      gov.acquire({ actorId: "a", action: "chat" });
      gov.acquire({ actorId: "b", action: "chat" });
      expect(gov.activeLeases).toBe(2);

      clock.advance(150);
      await new Promise((r) => setTimeout(r, 120));

      expect(gov.activeLeases).toBe(0);
      expect(events.filter((e) => e === "expire")).toHaveLength(2);
    } finally {
      gov.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. onEvent callback throws doesn't crash governor
// ---------------------------------------------------------------------------

describe("onEvent error isolation", () => {
  afterEach(() => {
    resetNow();
  });

  it("throwing onEvent doesn't prevent acquire from returning", () => {
    const clock = createTestClock(10_000);
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 5 },
      leaseTtlMs: 60_000,
      reaperIntervalMs: 100_000,
      onEvent: () => {
        throw new Error("boom from onEvent");
      },
    });

    try {
      // Should not throw — governor isolates onEvent errors
      const decision = gov.acquire({ actorId: "a", action: "chat" });
      expect(decision.granted).toBe(true);
      expect(gov.activeLeases).toBe(1);
    } finally {
      gov.dispose();
    }
  });

  it("throwing onEvent doesn't prevent release from completing", () => {
    const clock = createTestClock(10_000);
    setNow(clock.fn);

    let callCount = 0;
    const gov = new Governor({
      concurrency: { maxInFlight: 5 },
      leaseTtlMs: 60_000,
      reaperIntervalMs: 100_000,
      onEvent: () => {
        callCount++;
        if (callCount > 1) throw new Error("boom on release event");
      },
    });

    try {
      const d = gov.acquire({ actorId: "a", action: "chat" });
      expect(d.granted).toBe(true);
      if (!d.granted) return;

      // Release should succeed despite onEvent throwing
      gov.release(d.leaseId, { outcome: "success" });
      expect(gov.activeLeases).toBe(0);
      expect(gov.concurrencyActive).toBe(0);
    } finally {
      gov.dispose();
    }
  });

  it("throwing onEvent during deny doesn't prevent deny from returning", () => {
    const clock = createTestClock(10_000);
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 1 },
      leaseTtlMs: 60_000,
      reaperIntervalMs: 100_000,
      onEvent: () => {
        throw new Error("boom");
      },
    });

    try {
      gov.acquire({ actorId: "a", action: "chat" });
      // Second acquire triggers deny event — onEvent throws, but deny still returns
      const denied = gov.acquire({ actorId: "b", action: "chat" });
      expect(denied.granted).toBe(false);
    } finally {
      gov.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. dispose() then acquire() — clear deterministic behavior
// ---------------------------------------------------------------------------

describe("post-dispose behavior", () => {
  afterEach(() => {
    resetNow();
  });

  it("acquire after dispose still works (reaper stopped, leases still tracked)", () => {
    const clock = createTestClock(10_000);
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 2 },
      leaseTtlMs: 60_000,
      reaperIntervalMs: 5_000,
    });

    // Acquire before dispose
    const d1 = gov.acquire({ actorId: "a", action: "chat" });
    expect(d1.granted).toBe(true);

    gov.dispose();

    // Acquire after dispose — governor doesn't have a "disposed" flag,
    // so acquire should still work. The only effect of dispose is stopping
    // the reaper timer. Document actual behavior.
    const d2 = gov.acquire({ actorId: "b", action: "chat" });
    expect(d2.granted).toBe(true);
    expect(gov.activeLeases).toBe(2);

    // Release should still work after dispose
    if (d1.granted) gov.release(d1.leaseId, { outcome: "success" });
    if (d2.granted) gov.release(d2.leaseId, { outcome: "success" });
    expect(gov.activeLeases).toBe(0);
  });

  it("expired leases are NOT reaped after dispose (reaper stopped)", async () => {
    const clock = createTestClock(10_000);
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 1 },
      leaseTtlMs: 100,
      reaperIntervalMs: 50,
    });

    const d = gov.acquire({ actorId: "a", action: "chat" });
    expect(d.granted).toBe(true);

    gov.dispose(); // stops reaper

    // Advance past TTL
    clock.advance(200);
    await new Promise((r) => setTimeout(r, 120));

    // Reaper is stopped, so the expired lease should still be counted
    // (the store still has it, just nobody's sweeping)
    expect(gov.activeLeases).toBe(1);
  });

  it("double dispose does not throw", () => {
    const clock = createTestClock(10_000);
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 1 },
      leaseTtlMs: 60_000,
      reaperIntervalMs: 5_000,
    });

    gov.dispose();
    expect(() => gov.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. Concurrency mutation: parallel acquire/release
// ---------------------------------------------------------------------------

describe("concurrent parallel acquire/release", () => {
  afterEach(() => {
    resetNow();
  });

  it("parallel acquires respect maxInFlight", async () => {
    const clock = createTestClock(10_000);
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 3 },
      leaseTtlMs: 60_000,
      reaperIntervalMs: 100_000,
    });

    try {
      // Fire 10 parallel acquires (all synchronous, but via Promise.all pattern)
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          Promise.resolve(gov.acquire({ actorId: `actor-${i}`, action: "chat" })),
        ),
      );

      const granted = results.filter((r) => r.granted);
      const denied = results.filter((r) => !r.granted);

      // Exactly 3 should be granted (maxInFlight: 3)
      expect(granted).toHaveLength(3);
      expect(denied).toHaveLength(7);

      // Active leases should be exactly 3
      expect(gov.activeLeases).toBe(3);
      expect(gov.concurrencyActive).toBe(3);
    } finally {
      gov.dispose();
    }
  });

  it("parallel release then acquire frees then reuses slots", async () => {
    const clock = createTestClock(10_000);
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 2 },
      leaseTtlMs: 60_000,
      reaperIntervalMs: 100_000,
    });

    try {
      // Fill both slots
      const d1 = gov.acquire({ actorId: "a", action: "chat" });
      const d2 = gov.acquire({ actorId: "b", action: "chat" });
      expect(d1.granted).toBe(true);
      expect(d2.granted).toBe(true);
      expect(gov.concurrencyActive).toBe(2);

      if (!d1.granted || !d2.granted) return;

      // Release both in parallel, then immediately acquire 2 more
      await Promise.all([
        Promise.resolve(gov.release(d1.leaseId, { outcome: "success" })),
        Promise.resolve(gov.release(d2.leaseId, { outcome: "success" })),
      ]);

      expect(gov.concurrencyActive).toBe(0);

      // Now acquire 2 new ones
      const results = await Promise.all([
        Promise.resolve(gov.acquire({ actorId: "c", action: "chat" })),
        Promise.resolve(gov.acquire({ actorId: "d", action: "chat" })),
      ]);

      expect(results.every((r) => r.granted)).toBe(true);
      expect(gov.concurrencyActive).toBe(2);
    } finally {
      gov.dispose();
    }
  });

  it("interleaved acquire-release-acquire stays consistent", () => {
    const clock = createTestClock(10_000);
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 1 },
      leaseTtlMs: 60_000,
      reaperIntervalMs: 100_000,
    });

    try {
      // Rapid cycle: acquire, release, acquire — should never get stuck
      for (let i = 0; i < 100; i++) {
        const d = gov.acquire({ actorId: `actor-${i}`, action: "chat" });
        expect(d.granted).toBe(true);
        if (d.granted) {
          gov.release(d.leaseId, { outcome: "success" });
        }
      }

      // After all cycles, should be clean
      expect(gov.activeLeases).toBe(0);
      expect(gov.concurrencyActive).toBe(0);
    } finally {
      gov.dispose();
    }
  });
});
