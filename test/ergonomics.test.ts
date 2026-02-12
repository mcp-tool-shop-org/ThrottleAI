import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Governor } from "../src/governor.js";
import { withLease } from "../src/withLease.js";
import { setNow, resetNow } from "../src/utils/time.js";
// Types used via assertion narrowing, no direct reference needed

describe("limitsHint in deny payload", () => {
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

  it("concurrency deny includes inFlight and maxInFlight", () => {
    gov = new Governor({ concurrency: { maxInFlight: 2 }, leaseTtlMs: 60_000 });
    gov.acquire({ actorId: "a", action: "chat" });
    gov.acquire({ actorId: "b", action: "chat" });

    const d = gov.acquire({ actorId: "c", action: "chat" });
    expect(d.granted).toBe(false);
    if (!d.granted) {
      expect(d.limitsHint).toBeDefined();
      expect(d.limitsHint!.inFlight).toBe(2);
      expect(d.limitsHint!.maxInFlight).toBe(2);
    }
  });

  it("rate deny includes rateUsed and rateLimit", () => {
    gov = new Governor({
      rate: { requestsPerMinute: 2, windowMs: 60_000 },
      leaseTtlMs: 60_000,
    });

    gov.acquire({ actorId: "a", action: "chat" });
    gov.acquire({ actorId: "b", action: "chat" });
    const d = gov.acquire({ actorId: "c", action: "chat" });

    expect(d.granted).toBe(false);
    if (!d.granted) {
      expect(d.limitsHint).toBeDefined();
      expect(d.limitsHint!.rateUsed).toBe(2);
      expect(d.limitsHint!.rateLimit).toBe(2);
    }
  });

  it("fairness (policy) deny includes inFlight hints", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 4 },
      fairness: { softCapRatio: 0.5 },
      leaseTtlMs: 60_000,
    });

    // Actor "hog" fills to soft cap
    gov.acquire({ actorId: "hog", action: "chat" });
    gov.acquire({ actorId: "hog", action: "chat" });
    // Third should be denied by fairness
    const d = gov.acquire({ actorId: "hog", action: "chat" });

    expect(d.granted).toBe(false);
    if (!d.granted) {
      expect(d.reason).toBe("policy");
      expect(d.limitsHint).toBeDefined();
      expect(d.limitsHint!.inFlight).toBeDefined();
      expect(d.limitsHint!.maxInFlight).toBeDefined();
    }
  });

  it("token rate deny includes rateUsed and rateLimit", () => {
    gov = new Governor({
      rate: { tokensPerMinute: 100 },
      leaseTtlMs: 60_000,
    });

    // Consume most of the budget
    gov.acquire({
      actorId: "a",
      action: "chat",
      estimate: { promptTokens: 90, maxOutputTokens: 10 },
    });

    // This should push past the limit
    const d = gov.acquire({
      actorId: "b",
      action: "chat",
      estimate: { promptTokens: 50, maxOutputTokens: 50 },
    });

    expect(d.granted).toBe(false);
    if (!d.granted) {
      expect(d.limitsHint).toBeDefined();
      expect(d.limitsHint!.rateUsed).toBeDefined();
      expect(d.limitsHint!.rateLimit).toBe(100);
    }
  });
});

describe("withLease strategy option", () => {
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

  it('strategy "deny" returns immediately on denial', async () => {
    gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 60_000 });
    gov.acquire({ actorId: "fill", action: "chat" });

    const result = await withLease(
      gov,
      { actorId: "a", action: "chat" },
      async () => "nope",
      { strategy: "deny" },
    );

    expect(result.granted).toBe(false);
  });

  it('strategy "wait" retries until granted', async () => {
    gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 60_000 });
    const first = gov.acquire({ actorId: "fill", action: "chat" });
    if (!first.granted) throw new Error("setup failed");

    setTimeout(() => {
      gov.release(first.leaseId, { outcome: "success" });
    }, 80);

    const result = await withLease(
      gov,
      { actorId: "a", action: "chat" },
      async () => "waited",
      { strategy: "wait", maxWaitMs: 5_000, initialBackoffMs: 50 },
    );

    expect(result.granted).toBe(true);
    if (result.granted) {
      expect(result.result).toBe("waited");
    }
  });

  it('strategy "wait" returns denied when maxWaitMs exceeded', async () => {
    gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 60_000 });
    gov.acquire({ actorId: "fill", action: "chat" });

    const result = await withLease(
      gov,
      { actorId: "a", action: "chat" },
      async () => "nope",
      { strategy: "wait", maxWaitMs: 150, initialBackoffMs: 50 },
    );

    expect(result.granted).toBe(false);
  });

  it('strategy "wait-then-deny" retries up to maxAttempts', async () => {
    gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 60_000 });
    gov.acquire({ actorId: "fill", action: "chat" });

    let attempts = 0;
    const origAcquire = gov.acquire.bind(gov);
    gov.acquire = (req) => {
      attempts++;
      return origAcquire(req);
    };

    const result = await withLease(
      gov,
      { actorId: "a", action: "chat" },
      async () => "nope",
      { strategy: "wait-then-deny", maxAttempts: 3, maxWaitMs: 10_000, initialBackoffMs: 10 },
    );

    expect(result.granted).toBe(false);
    expect(attempts).toBe(3);
  });

  it('strategy "wait-then-deny" grants on retry', async () => {
    gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 60_000 });
    const first = gov.acquire({ actorId: "fill", action: "chat" });
    if (!first.granted) throw new Error("setup failed");

    // Release after first retry sleep
    setTimeout(() => {
      gov.release(first.leaseId, { outcome: "success" });
    }, 30);

    const result = await withLease(
      gov,
      { actorId: "a", action: "chat" },
      async () => "got it",
      { strategy: "wait-then-deny", maxAttempts: 5, initialBackoffMs: 10 },
    );

    expect(result.granted).toBe(true);
    if (result.granted) {
      expect(result.result).toBe("got it");
    }
  });

  it("backward compat: wait=true still works", async () => {
    gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 60_000 });
    const first = gov.acquire({ actorId: "fill", action: "chat" });
    if (!first.granted) throw new Error("setup failed");

    setTimeout(() => {
      gov.release(first.leaseId, { outcome: "success" });
    }, 80);

    const result = await withLease(
      gov,
      { actorId: "a", action: "chat" },
      async () => "waited",
      { wait: true, maxWaitMs: 5_000, initialBackoffMs: 50 },
    );

    expect(result.granted).toBe(true);
  });

  it("strategy takes precedence over wait boolean", async () => {
    gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 60_000 });
    gov.acquire({ actorId: "fill", action: "chat" });

    const result = await withLease(
      gov,
      { actorId: "a", action: "chat" },
      async () => "nope",
      { wait: true, strategy: "deny" }, // strategy wins
    );

    expect(result.granted).toBe(false);
  });
});

describe("idempotency across retries", () => {
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

  it("same idempotencyKey returns same lease", () => {
    gov = new Governor({ concurrency: { maxInFlight: 5 }, leaseTtlMs: 60_000 });

    const d1 = gov.acquire({ actorId: "a", action: "chat", idempotencyKey: "k1" });
    const d2 = gov.acquire({ actorId: "a", action: "chat", idempotencyKey: "k1" });

    expect(d1.granted).toBe(true);
    expect(d2.granted).toBe(true);
    if (d1.granted && d2.granted) {
      expect(d1.leaseId).toBe(d2.leaseId);
    }
    // Only 1 slot consumed
    expect(gov.concurrencyActive).toBe(1);
  });

  it("different idempotencyKeys get different leases", () => {
    gov = new Governor({ concurrency: { maxInFlight: 5 }, leaseTtlMs: 60_000 });

    const d1 = gov.acquire({ actorId: "a", action: "chat", idempotencyKey: "k1" });
    const d2 = gov.acquire({ actorId: "a", action: "chat", idempotencyKey: "k2" });

    expect(d1.granted).toBe(true);
    expect(d2.granted).toBe(true);
    if (d1.granted && d2.granted) {
      expect(d1.leaseId).not.toBe(d2.leaseId);
    }
    expect(gov.concurrencyActive).toBe(2);
  });

  it("expired idempotency key allows re-acquire", () => {
    gov = new Governor({ concurrency: { maxInFlight: 5 }, leaseTtlMs: 1_000 });

    const d1 = gov.acquire({ actorId: "a", action: "chat", idempotencyKey: "k1" });
    expect(d1.granted).toBe(true);
    if (!d1.granted) throw new Error("setup");

    // Release the lease
    gov.release(d1.leaseId, { outcome: "success" });

    // Now the idempotency key is gone (lease removed)
    const d2 = gov.acquire({ actorId: "a", action: "chat", idempotencyKey: "k1" });
    expect(d2.granted).toBe(true);
    if (d1.granted && d2.granted) {
      expect(d1.leaseId).not.toBe(d2.leaseId);
    }
  });
});
