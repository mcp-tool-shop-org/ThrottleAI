import { describe, it, expect, afterEach } from "vitest";
import { presets } from "../src/presets.js";
import { createGovernor } from "../src/createGovernor.js";
import type { Governor } from "../src/governor.js";

describe("presets", () => {
  let gov: Governor | null = null;

  afterEach(() => {
    gov?.dispose();
    gov = null;
  });

  it("quiet() creates a working governor", () => {
    const config = presets.quiet();
    gov = createGovernor(config);

    // maxInFlight = 1
    const d1 = gov.acquire({ actorId: "a", action: "chat" });
    expect(d1.granted).toBe(true);

    // Second should be denied (maxInFlight 1)
    const d2 = gov.acquire({ actorId: "a", action: "chat" });
    expect(d2.granted).toBe(false);
  });

  it("balanced() creates a working governor with fairness", () => {
    const config = presets.balanced();
    gov = createGovernor(config);

    expect(config.concurrency?.maxInFlight).toBe(5);
    expect(config.concurrency?.interactiveReserve).toBe(2);
    expect(config.rate?.requestsPerMinute).toBe(60);
    expect(config.rate?.tokensPerMinute).toBe(100_000);
    expect(config.fairness).toBe(true);

    // Should grant several requests
    for (let i = 0; i < 5; i++) {
      const d = gov.acquire({ actorId: `user-${i}`, action: "chat" });
      expect(d.granted).toBe(true);
    }
  });

  it("aggressive() creates a working governor with fairness + adaptive", () => {
    const config = presets.aggressive();
    gov = createGovernor(config);

    expect(config.concurrency?.maxInFlight).toBe(20);
    expect(config.concurrency?.interactiveReserve).toBe(5);
    expect(config.rate?.requestsPerMinute).toBe(300);
    expect(config.fairness).toBe(true);
    expect(config.adaptive).toBe(true);

    // Should grant many requests
    for (let i = 0; i < 15; i++) {
      const d = gov.acquire({ actorId: `user-${i}`, action: "chat" });
      expect(d.granted).toBe(true);
    }
  });

  it("presets can be spread and overridden", () => {
    const config = { ...presets.balanced(), leaseTtlMs: 5_000 };
    gov = createGovernor(config);

    expect(config.leaseTtlMs).toBe(5_000);
    expect(config.concurrency?.maxInFlight).toBe(5);
  });

  it("presets return fresh objects each time", () => {
    const a = presets.balanced();
    const b = presets.balanced();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
