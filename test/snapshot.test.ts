import { describe, it, expect, afterEach } from "vitest";
import { createGovernor } from "../src/createGovernor.js";
import { presets } from "../src/presets.js";
import type { Governor } from "../src/governor.js";
import type { GovernorEvent } from "../src/types.js";

describe("snapshot()", () => {
  let gov: Governor | null = null;

  afterEach(() => {
    gov?.dispose();
    gov = null;
  });

  it("returns null pools when nothing is configured", () => {
    gov = createGovernor({});
    const snap = gov.snapshot();

    expect(snap.activeLeases).toBe(0);
    expect(snap.concurrency).toBeNull();
    expect(snap.requestRate).toBeNull();
    expect(snap.tokenRate).toBeNull();
    expect(snap.fairness).toBe(false);
    expect(snap.adaptive).toBe(false);
    expect(typeof snap.timestamp).toBe("number");
  });

  it("reflects concurrency state after acquire", () => {
    gov = createGovernor({ concurrency: { maxInFlight: 3 } });

    gov.acquire({ actorId: "a", action: "chat" });
    gov.acquire({ actorId: "b", action: "chat" });

    const snap = gov.snapshot();
    expect(snap.activeLeases).toBe(2);
    expect(snap.concurrency!.active).toBe(2);
    expect(snap.concurrency!.available).toBe(1);
    expect(snap.concurrency!.max).toBe(3);
    expect(snap.concurrency!.effectiveMax).toBe(3);
  });

  it("reflects rate state", () => {
    gov = createGovernor({
      rate: { requestsPerMinute: 10, tokensPerMinute: 50_000 },
    });

    gov.acquire({ actorId: "a", action: "chat" });

    const snap = gov.snapshot();
    expect(snap.requestRate!.current).toBe(1);
    expect(snap.requestRate!.limit).toBe(10);
    expect(snap.tokenRate!.current).toBe(0); // no estimate → 0 tokens
    expect(snap.tokenRate!.limit).toBe(50_000);
  });

  it("shows fairness and adaptive flags from balanced preset", () => {
    gov = createGovernor(presets.balanced());
    const snap = gov.snapshot();
    expect(snap.fairness).toBe(true);
    expect(snap.adaptive).toBe(false);
  });

  it("shows adaptive flag from aggressive preset", () => {
    gov = createGovernor(presets.aggressive());
    const snap = gov.snapshot();
    expect(snap.fairness).toBe(true);
    expect(snap.adaptive).toBe(true);
  });

  it("updates after release", () => {
    gov = createGovernor({ concurrency: { maxInFlight: 2 } });

    const d = gov.acquire({ actorId: "a", action: "chat" });
    expect(gov.snapshot().concurrency!.active).toBe(1);

    if (d.granted) {
      gov.release(d.leaseId, { outcome: "success" });
    }

    expect(gov.snapshot().concurrency!.active).toBe(0);
    expect(gov.snapshot().activeLeases).toBe(0);
  });
});

describe("onEvent hook", () => {
  let gov: Governor | null = null;

  afterEach(() => {
    gov?.dispose();
    gov = null;
  });

  it("fires acquire event on successful acquire", () => {
    const events: GovernorEvent[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 2 },
      onEvent: (e) => events.push(e),
    });

    gov.acquire({ actorId: "alice", action: "chat" });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("acquire");
    expect(events[0].actorId).toBe("alice");
    expect(events[0].action).toBe("chat");
    expect(events[0].leaseId).toBeDefined();
    expect(events[0].weight).toBe(1);
  });

  it("fires deny event when concurrency is full", () => {
    const events: GovernorEvent[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 1 },
      onEvent: (e) => events.push(e),
    });

    gov.acquire({ actorId: "a", action: "chat" });
    gov.acquire({ actorId: "b", action: "chat" });

    const denyEvents = events.filter((e) => e.type === "deny");
    expect(denyEvents).toHaveLength(1);
    expect(denyEvents[0].reason).toBe("concurrency");
    expect(denyEvents[0].actorId).toBe("b");
    expect(denyEvents[0].retryAfterMs).toBeGreaterThan(0);
  });

  it("fires release event on release", () => {
    const events: GovernorEvent[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 2 },
      onEvent: (e) => events.push(e),
    });

    const d = gov.acquire({ actorId: "a", action: "chat" });
    if (d.granted) {
      gov.release(d.leaseId, { outcome: "success" });
    }

    const releaseEvents = events.filter((e) => e.type === "release");
    expect(releaseEvents).toHaveLength(1);
    expect(releaseEvents[0].actorId).toBe("a");
    expect(releaseEvents[0].outcome).toBe("success");
    expect(releaseEvents[0].leaseId).toBe(d.granted ? d.leaseId : undefined);
  });

  it("fires deny event for rate limit", () => {
    const events: GovernorEvent[] = [];
    gov = createGovernor({
      rate: { requestsPerMinute: 1 },
      onEvent: (e) => events.push(e),
    });

    gov.acquire({ actorId: "a", action: "chat" }); // granted
    gov.acquire({ actorId: "a", action: "chat" }); // denied (rate)

    const denyEvents = events.filter((e) => e.type === "deny");
    expect(denyEvents).toHaveLength(1);
    expect(denyEvents[0].reason).toBe("rate");
  });

  it("does not fire events when no handler is configured", () => {
    // Just verifying no errors occur
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });

    const d = gov.acquire({ actorId: "a", action: "chat" });
    gov.acquire({ actorId: "b", action: "chat" }); // denied
    if (d.granted) {
      gov.release(d.leaseId, { outcome: "success" });
    }
    // No assertion — just ensuring no crash
  });

  it("captures all event types in sequence", () => {
    const events: GovernorEvent[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 1 },
      onEvent: (e) => events.push(e),
    });

    // acquire
    const d = gov.acquire({ actorId: "a", action: "chat" });
    // deny
    gov.acquire({ actorId: "b", action: "chat" });
    // release
    if (d.granted) {
      gov.release(d.leaseId, { outcome: "error" });
    }

    const types = events.map((e) => e.type);
    expect(types).toEqual(["acquire", "deny", "release"]);
    expect(events[2].outcome).toBe("error");
  });

  it("includes weight in events for weighted requests", () => {
    const events: GovernorEvent[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      onEvent: (e) => events.push(e),
    });

    gov.acquire({
      actorId: "a",
      action: "embed",
      estimate: { weight: 3 },
    });

    expect(events[0].weight).toBe(3);
  });
});
