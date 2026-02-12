import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Governor } from "../src/governor.js";
import { withLease } from "../src/withLease.js";
import { setNow, resetNow } from "../src/utils/time.js";

describe("withLease", () => {
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

  it("granted: runs fn and releases with success", async () => {
    gov = new Governor({ concurrency: { maxInFlight: 2 }, leaseTtlMs: 60_000 });

    const result = await withLease(
      gov,
      { actorId: "a", action: "chat" },
      async () => "hello",
    );

    expect(result.granted).toBe(true);
    if (result.granted) {
      expect(result.result).toBe("hello");
    }
    expect(gov.activeLeases).toBe(0);
    expect(gov.concurrencyActive).toBe(0);
  });

  it("granted: fn throws → releases with error, re-throws", async () => {
    gov = new Governor({ concurrency: { maxInFlight: 2 }, leaseTtlMs: 60_000 });

    await expect(
      withLease(gov, { actorId: "a", action: "chat" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Lease should be released
    expect(gov.activeLeases).toBe(0);
    expect(gov.concurrencyActive).toBe(0);
  });

  it("denied: returns denied decision (no wait)", async () => {
    gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 60_000 });
    gov.acquire({ actorId: "fill", action: "chat" });

    const result = await withLease(
      gov,
      { actorId: "a", action: "chat" },
      async () => "should not run",
    );

    expect(result.granted).toBe(false);
    if (!result.granted) {
      expect(result.decision.reason).toBe("concurrency");
    }
  });

  it("denied + wait: retries and eventually grants", async () => {
    gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 60_000 });
    const first = gov.acquire({ actorId: "fill", action: "chat" });
    if (!first.granted) throw new Error("setup failed");

    // Release after a short delay
    setTimeout(() => {
      gov.release(first.leaseId, { outcome: "success" });
    }, 100);

    const result = await withLease(
      gov,
      { actorId: "a", action: "chat" },
      async () => "waited",
      { wait: true, maxWaitMs: 5_000, initialBackoffMs: 50 },
    );

    expect(result.granted).toBe(true);
    if (result.granted) {
      expect(result.result).toBe("waited");
    }
  });

  it("denied + wait + maxWaitMs exceeded: returns denied", async () => {
    gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 60_000 });
    gov.acquire({ actorId: "fill", action: "chat" });

    const result = await withLease(
      gov,
      { actorId: "a", action: "chat" },
      async () => "should not run",
      { wait: true, maxWaitMs: 200, initialBackoffMs: 50 },
    );

    expect(result.granted).toBe(false);
    if (!result.granted) {
      expect(result.decision.reason).toBe("concurrency");
    }
  });
});
