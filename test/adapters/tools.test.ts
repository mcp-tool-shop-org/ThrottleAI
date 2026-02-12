import { describe, it, expect, afterEach } from "vitest";
import { createGovernor } from "../../src/createGovernor.js";
import { wrapTool } from "../../src/adapters/tools.js";
import type { Governor } from "../../src/governor.js";
import type { GovernorEvent } from "../../src/types.js";

describe("wrapTool", () => {
  let gov: Governor | null = null;

  afterEach(() => {
    gov?.dispose();
    gov = null;
  });

  it("wraps a simple async function", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 5 } });

    const embed = wrapTool(
      async (text: string) => [0.1, 0.2, 0.3, text.length],
      { governor: gov, toolId: "embed" },
    );

    const result = await embed("hello");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toEqual([0.1, 0.2, 0.3, 5]);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns denied when governor denies", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });

    const slow = wrapTool(
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        return "done";
      },
      { governor: gov, toolId: "slow" },
    );

    // First call holds the lease
    const p1 = slow();

    // Second call denied
    const result2 = await slow();

    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.decision.reason).toBe("concurrency");
    }

    await p1;
  });

  it("releases lease on error", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });

    const failing = wrapTool(
      async () => {
        throw new Error("tool failed");
      },
      { governor: gov, toolId: "fail" },
    );

    const ok = wrapTool(
      async () => "ok",
      { governor: gov, toolId: "ok" },
    );

    await expect(failing()).rejects.toThrow("tool failed");

    // Lease released — next should succeed
    const r2 = await ok();
    expect(r2.ok).toBe(true);
  });

  it("uses toolId as action prefix", async () => {
    const events: GovernorEvent[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      onEvent: (e) => events.push(e),
    });

    const embed = wrapTool(
      async () => [1, 2, 3],
      { governor: gov, toolId: "embed" },
    );

    await embed();

    const acquireEvents = events.filter((e) => e.type === "acquire");
    expect(acquireEvents[0].action).toBe("tool.embed");
  });

  it("defaults to background priority", async () => {
    gov = createGovernor({
      concurrency: { maxInFlight: 3, interactiveReserve: 2 },
    });

    // Fill 1 slot with background tool
    const tool = wrapTool(
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        return "done";
      },
      { governor: gov, toolId: "embed" },
    );

    const p1 = tool();

    // Background should be blocked by reserve when only reserve slots remain
    // maxInFlight=3, reserve=2, 1 bg active → 2 remaining, which equals reserve → blocked
    const r2 = await tool();
    expect(r2.ok).toBe(false);

    await p1;
  });

  it("supports costWeight for heavy tools", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 5 } });
    const events: GovernorEvent[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      onEvent: (e) => events.push(e),
    });

    const heavyTool = wrapTool(
      async () => "done",
      { governor: gov, toolId: "rerank", costWeight: 3 },
    );

    await heavyTool();

    expect(events[0].weight).toBe(3);
  });

  it("allows custom actorId and priority", async () => {
    const events: GovernorEvent[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      onEvent: (e) => events.push(e),
    });

    const tool = wrapTool(
      async () => 42,
      {
        governor: gov,
        toolId: "compute",
        actorId: "batch-worker",
        priority: "interactive",
      },
    );

    await tool();

    expect(events[0].actorId).toBe("batch-worker");
  });

  it("passes multiple args through to the wrapped function", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 5 } });

    const add = wrapTool(
      async (a: number, b: number) => a + b,
      { governor: gov, toolId: "add" },
    );

    const result = await add(3, 7);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe(10);
    }
  });
});
