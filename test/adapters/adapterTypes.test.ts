import { describe, it, expect } from "vitest";
import { classifyOutcome } from "../../src/adapters/types.js";
import type {
  AdapterGovernor,
  AdapterOptions,
  AdapterResult,
  AdapterGranted,
  AdapterDenied,
  ProviderUsage,
} from "../../src/adapters/types.js";

describe("adapter types", () => {
  it("classifyOutcome returns error for exceptions", () => {
    expect(classifyOutcome(new Error("boom"))).toBe("error");
  });

  it("classifyOutcome returns error for 4xx/5xx status codes", () => {
    expect(classifyOutcome(null, 400)).toBe("error");
    expect(classifyOutcome(null, 500)).toBe("error");
    expect(classifyOutcome(null, 429)).toBe("error");
  });

  it("classifyOutcome returns success for 2xx", () => {
    expect(classifyOutcome(null, 200)).toBe("success");
    expect(classifyOutcome(null, 201)).toBe("success");
  });

  it("classifyOutcome returns success when no error and no status", () => {
    expect(classifyOutcome(null)).toBe("success");
    expect(classifyOutcome(undefined)).toBe("success");
  });

  it("adapter types are importable and usable", () => {
    // Type-level assertions — just ensure these compile
    const _gov: AdapterGovernor = {
      acquire: () => ({ granted: true, leaseId: "x", expiresAt: 0 }),
      release: () => {},
    };

    const _opts: AdapterOptions = {
      governor: _gov,
      actorId: "test",
      priority: "interactive",
    };

    const _usage: ProviderUsage = {
      promptTokens: 10,
      outputTokens: 20,
    };

    const _granted: AdapterGranted<string> = {
      ok: true,
      result: "hello",
      latencyMs: 50,
    };

    const _denied: AdapterDenied = {
      ok: false,
      decision: {
        granted: false,
        reason: "concurrency",
        retryAfterMs: 500,
        recommendation: "wait",
      },
    };

    const _result: AdapterResult<string> = _granted;
    expect(_result.ok).toBe(true);

    // Prove these variables are used (avoid unused warnings)
    expect(_opts.actorId).toBe("test");
    expect(_usage.promptTokens).toBe(10);
    expect(_denied.ok).toBe(false);
  });
});
