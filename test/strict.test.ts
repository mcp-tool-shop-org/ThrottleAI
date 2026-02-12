import { describe, it, expect, afterEach } from "vitest";
import { createGovernor } from "../src/createGovernor.js";
import type { Governor } from "../src/governor.js";
import type { GovernorEvent } from "../src/types.js";
import { setNow as setNowFn, resetNow } from "../src/utils/time.js";

/** Helper: set clock to a fixed timestamp. */
function setNow(ms: number): void {
  setNowFn(() => ms);
}

describe("strict mode", () => {
  let gov: Governor | null = null;

  afterEach(() => {
    gov?.dispose();
    gov = null;
    resetNow();
  });

  it("throws on double release", () => {
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      strict: true,
    });

    const d = gov.acquire({ actorId: "a", action: "chat" });
    expect(d.granted).toBe(true);
    if (!d.granted) return;

    gov.release(d.leaseId, { outcome: "success" });

    expect(() => {
      gov!.release(d.leaseId, { outcome: "success" });
    }).toThrow(/Double release/);
  });

  it("throws on unknown lease ID", () => {
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      strict: true,
    });

    expect(() => {
      gov!.release("nonexistent-lease-id", { outcome: "success" });
    }).toThrow(/Unknown lease ID/);
  });

  it("does NOT throw on double release when strict is off", () => {
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
    });

    const d = gov.acquire({ actorId: "a", action: "chat" });
    if (!d.granted) return;

    gov.release(d.leaseId, { outcome: "success" });

    // Should not throw — just a no-op
    expect(() => {
      gov!.release(d.leaseId, { outcome: "success" });
    }).not.toThrow();
  });

  it("does NOT throw on unknown lease ID when strict is off", () => {
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
    });

    // Should not throw — just a no-op
    expect(() => {
      gov!.release("nonexistent-lease-id", { outcome: "success" });
    }).not.toThrow();
  });

  it("emits warn event for long-held leases (>80% TTL)", () => {
    const events: GovernorEvent[] = [];
    const t0 = 1_000_000;
    setNow(t0);

    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      leaseTtlMs: 10_000,
      strict: true,
      onEvent: (e) => events.push(e),
    });

    const d = gov.acquire({ actorId: "a", action: "chat" });
    expect(d.granted).toBe(true);
    if (!d.granted) return;

    // Advance time to 85% of TTL
    setNow(t0 + 8_500);
    gov.release(d.leaseId, { outcome: "success" });

    const warnEvents = events.filter((e) => e.type === "warn");
    expect(warnEvents).toHaveLength(1);
    expect(warnEvents[0].message).toContain("85%");
    expect(warnEvents[0].message).toContain("10000ms TTL");
    expect(warnEvents[0].leaseId).toBe(d.leaseId);
  });

  it("does NOT emit warn for normal-duration leases", () => {
    const events: GovernorEvent[] = [];
    const t0 = 1_000_000;
    setNow(t0);

    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      leaseTtlMs: 10_000,
      strict: true,
      onEvent: (e) => events.push(e),
    });

    const d = gov.acquire({ actorId: "a", action: "chat" });
    if (!d.granted) return;

    // Release at 50% of TTL — should NOT warn
    setNow(t0 + 5_000);
    gov.release(d.leaseId, { outcome: "success" });

    const warnEvents = events.filter((e) => e.type === "warn");
    expect(warnEvents).toHaveLength(0);
  });

  it("error message includes the lease ID", () => {
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      strict: true,
    });

    const d = gov.acquire({ actorId: "a", action: "chat" });
    if (!d.granted) return;

    gov.release(d.leaseId, { outcome: "success" });

    try {
      gov.release(d.leaseId, { outcome: "success" });
    } catch (e: unknown) {
      expect((e as Error).message).toContain(d.leaseId);
    }
  });

  it("strict mode still works with normal acquire/release flow", () => {
    gov = createGovernor({
      concurrency: { maxInFlight: 2 },
      strict: true,
    });

    const d1 = gov.acquire({ actorId: "a", action: "chat" });
    const d2 = gov.acquire({ actorId: "b", action: "chat" });

    expect(d1.granted).toBe(true);
    expect(d2.granted).toBe(true);

    if (d1.granted) gov.release(d1.leaseId, { outcome: "success" });
    if (d2.granted) gov.release(d2.leaseId, { outcome: "success" });

    // Now capacity is free again
    const d3 = gov.acquire({ actorId: "c", action: "chat" });
    expect(d3.granted).toBe(true);
  });

  it("warn event includes actionable suggestion", () => {
    const events: GovernorEvent[] = [];
    const t0 = 1_000_000;
    setNow(t0);

    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      leaseTtlMs: 5_000,
      strict: true,
      onEvent: (e) => events.push(e),
    });

    const d = gov.acquire({ actorId: "a", action: "chat" });
    if (!d.granted) return;

    // 90% of TTL
    setNow(t0 + 4_500);
    gov.release(d.leaseId, { outcome: "success" });

    const warns = events.filter((e) => e.type === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toContain("releasing sooner");
  });
});
