import { describe, it, expect, afterEach } from "vitest";
import { createGovernor } from "../../src/createGovernor.js";
import { wrapFetch } from "../../src/adapters/fetch.js";
import type { Governor } from "../../src/governor.js";

/** Minimal fake Response for testing (no real HTTP needed). */
function fakeResponse(status: number, body?: object): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body ?? {}),
    text: () => Promise.resolve(JSON.stringify(body ?? {})),
    headers: new Headers(),
    redirected: false,
    statusText: status === 200 ? "OK" : "Error",
    type: "basic",
    url: "",
    clone: () => fakeResponse(status, body),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

/** Create a fake fetch that resolves after a delay. */
function createFakeFetch(status = 200, delayMs = 10, body?: object) {
  let callCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fn = async (_input: string | URL | Request, _init?: RequestInit) => {
    callCount++;
    await new Promise((r) => setTimeout(r, delayMs));
    return fakeResponse(status, body);
  };
  return { fn, getCallCount: () => callCount };
}

/** Create a fake fetch that throws. */
function createThrowingFetch(delayMs = 5) {
  const fn = async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    throw new Error("network error");
  };
  return { fn };
}

describe("wrapFetch", () => {
  let gov: Governor | null = null;

  afterEach(() => {
    gov?.dispose();
    gov = null;
  });

  it("passes through a successful fetch", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 5 } });
    const { fn } = createFakeFetch(200, 10, { message: "ok" });
    const throttled = wrapFetch(fn, { governor: gov });

    const result = await throttled("https://api.example.com/v1/chat");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.status).toBe(200);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns denied decision when governor denies", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });
    const { fn, getCallCount } = createFakeFetch(200, 50);
    const throttled = wrapFetch(fn, { governor: gov });

    // First call acquires the lease
    const p1 = throttled("https://api.example.com/v1/chat");

    // Second call should be denied (concurrent)
    const result2 = await throttled("https://api.example.com/v1/chat");

    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.decision.reason).toBe("concurrency");
      expect(result2.decision.retryAfterMs).toBeGreaterThan(0);
    }

    // Wait for first to finish
    await p1;
    expect(getCallCount()).toBe(1); // Only first call went through
  });

  it("releases lease after successful fetch", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });
    const { fn } = createFakeFetch(200, 5);
    const throttled = wrapFetch(fn, { governor: gov });

    // First call
    const r1 = await throttled("https://api.example.com/v1/chat");
    expect(r1.ok).toBe(true);

    // Lease released — second call should succeed
    const r2 = await throttled("https://api.example.com/v1/chat");
    expect(r2.ok).toBe(true);
  });

  it("releases lease on fetch error", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });
    const { fn: throwFn } = createThrowingFetch();
    const { fn: okFn } = createFakeFetch(200, 5);
    const throttledThrow = wrapFetch(throwFn, { governor: gov });
    const throttledOk = wrapFetch(okFn, { governor: gov });

    // First call throws — should still release
    await expect(
      throttledThrow("https://api.example.com/v1/chat"),
    ).rejects.toThrow("network error");

    // Lease released — next call should succeed
    const r2 = await throttledOk("https://api.example.com/v1/chat");
    expect(r2.ok).toBe(true);
  });

  it("uses custom actorId and priority", async () => {
    const events: { actorId?: string; action?: string }[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      onEvent: (e) => {
        if (e.type === "acquire") events.push(e);
      },
    });
    const { fn } = createFakeFetch(200, 5);
    const throttled = wrapFetch(fn, {
      governor: gov,
      actorId: "alice",
      priority: "background",
    });

    await throttled("https://api.example.com/v1/embeddings");

    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe("alice");
  });

  it("derives action from URL pathname by default", async () => {
    const events: { action?: string }[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      onEvent: (e) => {
        if (e.type === "acquire") events.push(e);
      },
    });
    const { fn } = createFakeFetch(200, 5);
    const throttled = wrapFetch(fn, { governor: gov });

    await throttled("https://api.example.com/v1/chat/completions");

    expect(events[0].action).toBe("/v1/chat/completions");
  });

  it("uses custom classifyAction", async () => {
    const events: { action?: string }[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      onEvent: (e) => {
        if (e.type === "acquire") events.push(e);
      },
    });
    const { fn } = createFakeFetch(200, 5);
    const throttled = wrapFetch(fn, {
      governor: gov,
      classifyAction: () => "custom-action",
    });

    await throttled("https://api.example.com/v1/chat");

    expect(events[0].action).toBe("custom-action");
  });

  it("passes token estimate to governor", async () => {
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      rate: { tokensPerMinute: 100_000 },
    });
    const { fn } = createFakeFetch(200, 5);
    const throttled = wrapFetch(fn, {
      governor: gov,
      estimate: () => ({ promptTokens: 500, maxOutputTokens: 200 }),
    });

    const result = await throttled("https://api.example.com/v1/chat");
    expect(result.ok).toBe(true);

    // Token rate pool should have recorded the estimate
    expect(gov.tokenRateCount).toBe(700);
  });
});
