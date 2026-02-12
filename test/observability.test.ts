import { describe, it, expect, afterEach } from "vitest";
import { Governor } from "../src/governor.js";
import { formatEvent, formatSnapshot } from "../src/format.js";
import { setNow, resetNow, createTestClock } from "../src/utils/time.js";
import type { GovernorEvent } from "../src/types.js";

describe("snapshot() enhanced fields", () => {
  afterEach(() => {
    resetNow();
  });

  it("includes inFlightWeight and inFlightCount", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    const gov = new Governor({ concurrency: { maxInFlight: 5 }, leaseTtlMs: 60_000 });
    gov.acquire({ actorId: "a", action: "chat" });
    gov.acquire({ actorId: "b", action: "chat", estimate: { weight: 3 } });

    const snap = gov.snapshot();
    expect(snap.concurrency).not.toBeNull();
    expect(snap.concurrency!.inFlightWeight).toBe(4); // 1 + 3
    expect(snap.concurrency!.inFlightCount).toBe(2);
    // deprecated alias
    expect(snap.concurrency!.active).toBe(snap.concurrency!.inFlightWeight);

    gov.dispose();
  });

  it("includes lastDeny after a denial", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    const gov = new Governor({ concurrency: { maxInFlight: 1 }, leaseTtlMs: 60_000 });
    gov.acquire({ actorId: "a", action: "chat" });

    expect(gov.snapshot().lastDeny).toBeNull();

    gov.acquire({ actorId: "b", action: "chat" });
    const snap = gov.snapshot();
    expect(snap.lastDeny).not.toBeNull();
    expect(snap.lastDeny!.reason).toBe("concurrency");
    expect(snap.lastDeny!.actorId).toBe("b");
    expect(snap.lastDeny!.timestamp).toBe(clock.time);

    gov.dispose();
  });

  it("lastDeny updates with each new denial", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 1 },
      leaseTtlMs: 60_000,
    });
    gov.acquire({ actorId: "a", action: "chat" });

    gov.acquire({ actorId: "b", action: "chat" });
    clock.advance(100);
    gov.acquire({ actorId: "c", action: "chat" });

    expect(gov.snapshot().lastDeny!.actorId).toBe("c");

    gov.dispose();
  });
});

describe("deny events include recommendation", () => {
  afterEach(() => {
    resetNow();
  });

  it("concurrency deny event has recommendation", () => {
    const clock = createTestClock();
    setNow(clock.fn);
    const events: GovernorEvent[] = [];

    const gov = new Governor({
      concurrency: { maxInFlight: 1 },
      leaseTtlMs: 60_000,
      onEvent: (e) => events.push(e),
    });

    gov.acquire({ actorId: "a", action: "chat" });
    gov.acquire({ actorId: "b", action: "chat" });

    const deny = events.find((e) => e.type === "deny");
    expect(deny).toBeDefined();
    expect(deny!.recommendation).toBeDefined();
    expect(deny!.recommendation).toContain("slots in use");

    gov.dispose();
  });

  it("rate deny event has recommendation", () => {
    const clock = createTestClock();
    setNow(clock.fn);
    const events: GovernorEvent[] = [];

    const gov = new Governor({
      rate: { requestsPerMinute: 1 },
      leaseTtlMs: 60_000,
      onEvent: (e) => events.push(e),
    });

    gov.acquire({ actorId: "a", action: "chat" });
    gov.acquire({ actorId: "b", action: "chat" });

    const deny = events.find((e) => e.type === "deny");
    expect(deny).toBeDefined();
    expect(deny!.recommendation).toContain("Rate limit");

    gov.dispose();
  });
});

describe("formatEvent", () => {
  it("formats acquire event", () => {
    const s = formatEvent({
      type: "acquire",
      timestamp: 100_000,
      actorId: "user-1",
      action: "chat",
      leaseId: "abcdef12-3456-7890-abcd-ef1234567890",
      weight: 1,
    });
    expect(s).toContain("[acquire]");
    expect(s).toContain("actor=user-1");
    expect(s).toContain("action=chat");
    expect(s).toContain("lease=abcdef12");
    // weight=1 should not appear (default)
    expect(s).not.toContain("weight=");
  });

  it("formats acquire with non-default weight", () => {
    const s = formatEvent({
      type: "acquire",
      timestamp: 100_000,
      actorId: "user-1",
      action: "embed",
      leaseId: "abcdef12-xxxx",
      weight: 3,
    });
    expect(s).toContain("weight=3");
  });

  it("formats deny event with recommendation", () => {
    const s = formatEvent({
      type: "deny",
      timestamp: 100_000,
      actorId: "user-2",
      action: "chat",
      reason: "concurrency",
      retryAfterMs: 500,
      recommendation: "All 5 slots in use.",
    });
    expect(s).toContain("[deny]");
    expect(s).toContain("reason=concurrency");
    expect(s).toContain("retryAfterMs=500");
    expect(s).toContain("— All 5 slots in use.");
  });

  it("formats release event", () => {
    const s = formatEvent({
      type: "release",
      timestamp: 100_000,
      actorId: "user-1",
      action: "chat",
      leaseId: "abcdef12-xxxx",
      outcome: "success",
    });
    expect(s).toContain("[release]");
    expect(s).toContain("outcome=success");
  });

  it("formats warn event", () => {
    const s = formatEvent({
      type: "warn",
      timestamp: 100_000,
      leaseId: "abcdef12-xxxx",
      message: "Lease held too long",
    });
    expect(s).toContain("[warn]");
    expect(s).toContain("Lease held too long");
  });

  it("formats expire event", () => {
    const s = formatEvent({
      type: "expire",
      timestamp: 100_000,
      actorId: "user-1",
      action: "chat",
      leaseId: "abcdef12-xxxx",
    });
    expect(s).toContain("[expire]");
    expect(s).toContain("actor=user-1");
  });
});

describe("formatSnapshot", () => {
  afterEach(() => {
    resetNow();
  });

  it("formats basic snapshot", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 5 },
      rate: { requestsPerMinute: 60 },
      leaseTtlMs: 60_000,
    });

    gov.acquire({ actorId: "a", action: "chat" });
    gov.acquire({ actorId: "b", action: "chat" });

    const s = formatSnapshot(gov.snapshot());
    expect(s).toContain("concurrency=2/5");
    expect(s).toContain("rate=2/60");
    expect(s).toContain("leases=2");
    expect(s).not.toContain("lastDeny");

    gov.dispose();
  });

  it("includes lastDeny when present", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    const gov = new Governor({
      concurrency: { maxInFlight: 1 },
      leaseTtlMs: 60_000,
    });

    gov.acquire({ actorId: "a", action: "chat" });
    gov.acquire({ actorId: "b", action: "chat" }); // denied

    const s = formatSnapshot(gov.snapshot());
    expect(s).toContain("lastDeny=concurrency");

    gov.dispose();
  });

  it("formats snapshot without concurrency", () => {
    const clock = createTestClock();
    setNow(clock.fn);

    const gov = new Governor({
      rate: { requestsPerMinute: 10 },
      leaseTtlMs: 60_000,
    });

    const s = formatSnapshot(gov.snapshot());
    expect(s).toContain("rate=0/10");
    expect(s).not.toContain("concurrency");

    gov.dispose();
  });
});
