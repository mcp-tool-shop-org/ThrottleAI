import { describe, it, expect, beforeEach } from "vitest";
import { createGovernor, createStatsCollector } from "../src/index.js";
import type { GovernorEvent } from "../src/index.js";

describe("createStatsCollector", () => {
  let stats: ReturnType<typeof createStatsCollector>;

  beforeEach(() => {
    stats = createStatsCollector();
  });

  it("counts grants from acquire events", () => {
    stats.handler({ type: "acquire", timestamp: 1 } as GovernorEvent);
    stats.handler({ type: "acquire", timestamp: 2 } as GovernorEvent);
    const snap = stats.snapshot();
    expect(snap.grants).toBe(2);
    expect(snap.totalEvents).toBe(2);
  });

  it("counts denials and breaks down by reason", () => {
    stats.handler({ type: "deny", timestamp: 1, reason: "concurrency" } as GovernorEvent);
    stats.handler({ type: "deny", timestamp: 2, reason: "rate" } as GovernorEvent);
    stats.handler({ type: "deny", timestamp: 3, reason: "concurrency" } as GovernorEvent);
    const snap = stats.snapshot();
    expect(snap.denials).toBe(3);
    expect(snap.denialsByReason.concurrency).toBe(2);
    expect(snap.denialsByReason.rate).toBe(1);
    expect(snap.denialsByReason.budget).toBe(0);
    expect(snap.denialsByReason.policy).toBe(0);
  });

  it("counts releases and tracks outcomes", () => {
    stats.handler({ type: "release", timestamp: 1, outcome: "success" } as GovernorEvent);
    stats.handler({ type: "release", timestamp: 2, outcome: "error" } as GovernorEvent);
    stats.handler({ type: "release", timestamp: 3, outcome: "success" } as GovernorEvent);
    const snap = stats.snapshot();
    expect(snap.releases).toBe(3);
    expect(snap.outcomes).toEqual({ success: 2, error: 1 });
  });

  it("counts expire events", () => {
    stats.handler({ type: "expire", timestamp: 1 } as GovernorEvent);
    const snap = stats.snapshot();
    expect(snap.expires).toBe(1);
  });

  it("counts warn events in totalEvents", () => {
    stats.handler({ type: "warn", timestamp: 1, message: "test" } as GovernorEvent);
    const snap = stats.snapshot();
    expect(snap.totalEvents).toBe(1);
    expect(snap.grants).toBe(0);
    expect(snap.denials).toBe(0);
  });

  it("computes denyRate correctly", () => {
    stats.handler({ type: "acquire", timestamp: 1 } as GovernorEvent);
    stats.handler({ type: "acquire", timestamp: 2 } as GovernorEvent);
    stats.handler({ type: "acquire", timestamp: 3 } as GovernorEvent);
    stats.handler({ type: "deny", timestamp: 4, reason: "concurrency" } as GovernorEvent);
    const snap = stats.snapshot();
    // 1 denial out of 4 decisions = 0.25
    expect(snap.denyRate).toBeCloseTo(0.25);
  });

  it("returns NaN denyRate when no decisions", () => {
    const snap = stats.snapshot();
    expect(snap.denyRate).toBeNaN();
  });

  it("tracks latency via recordLatency", () => {
    stats.recordLatency(100);
    stats.recordLatency(200);
    stats.recordLatency(50);
    const snap = stats.snapshot();
    expect(snap.latencySamples).toBe(3);
    expect(snap.avgLatencyMs).toBeCloseTo(350 / 3);
    expect(snap.minLatencyMs).toBe(50);
    expect(snap.maxLatencyMs).toBe(200);
  });

  it("ignores non-positive latency", () => {
    stats.recordLatency(0);
    stats.recordLatency(-10);
    const snap = stats.snapshot();
    expect(snap.latencySamples).toBe(0);
    expect(snap.avgLatencyMs).toBeNaN();
  });

  it("returns NaN avgLatency and Infinity min/max when no samples", () => {
    const snap = stats.snapshot();
    expect(snap.avgLatencyMs).toBeNaN();
    expect(snap.minLatencyMs).toBe(Infinity);
    expect(snap.maxLatencyMs).toBe(-Infinity);
    expect(snap.latencySamples).toBe(0);
  });

  it("reset() clears all counters", () => {
    stats.handler({ type: "acquire", timestamp: 1 } as GovernorEvent);
    stats.handler({ type: "deny", timestamp: 2, reason: "rate" } as GovernorEvent);
    stats.handler({ type: "release", timestamp: 3, outcome: "success" } as GovernorEvent);
    stats.handler({ type: "expire", timestamp: 4 } as GovernorEvent);
    stats.recordLatency(100);

    stats.reset();
    const snap = stats.snapshot();

    expect(snap.grants).toBe(0);
    expect(snap.denials).toBe(0);
    expect(snap.releases).toBe(0);
    expect(snap.expires).toBe(0);
    expect(snap.totalEvents).toBe(0);
    expect(snap.latencySamples).toBe(0);
    expect(snap.denyRate).toBeNaN();
    expect(snap.avgLatencyMs).toBeNaN();
    expect(snap.denialsByReason.rate).toBe(0);
    expect(snap.outcomes).toEqual({});
  });

  it("snapshot returns a copy (not live reference)", () => {
    stats.handler({ type: "acquire", timestamp: 1 } as GovernorEvent);
    const snap1 = stats.snapshot();
    stats.handler({ type: "acquire", timestamp: 2 } as GovernorEvent);
    const snap2 = stats.snapshot();
    expect(snap1.grants).toBe(1);
    expect(snap2.grants).toBe(2);
  });

  it("integrates with a real governor", () => {
    const gov = createGovernor({
      concurrency: { maxInFlight: 1 },
      onEvent: stats.handler,
    });

    const d1 = gov.acquire({ actorId: "a", action: "test" });
    expect(d1.granted).toBe(true);

    // Second acquire should be denied (only 1 slot)
    const d2 = gov.acquire({ actorId: "b", action: "test" });
    expect(d2.granted).toBe(false);

    // Release the first lease
    if (d1.granted) gov.release(d1.leaseId, { outcome: "success" });

    const snap = stats.snapshot();
    expect(snap.grants).toBe(1);
    expect(snap.denials).toBe(1);
    expect(snap.releases).toBe(1);
    expect(snap.denyRate).toBeCloseTo(0.5);
    expect(snap.outcomes).toEqual({ success: 1 });

    gov.dispose();
  });
});
