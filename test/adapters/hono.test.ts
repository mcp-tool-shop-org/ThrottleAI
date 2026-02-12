import { describe, it, expect, afterEach } from "vitest";
import { createGovernor } from "../../src/createGovernor.js";
import { throttle } from "../../src/adapters/hono.js";
import type { Governor } from "../../src/governor.js";
import type { HonoLikeContext } from "../../src/adapters/hono.js";

/** Create a fake Hono context. */
function fakeContext(overrides: {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
} = {}): HonoLikeContext & {
  _jsonCalls: { body: unknown; status?: number }[];
  _headers: Record<string, string>;
  _store: Record<string, unknown>;
  _nextCalled: boolean;
} {
  const headers = overrides.headers ?? {};
  const ctx = {
    _jsonCalls: [] as { body: unknown; status?: number }[],
    _headers: {} as Record<string, string>,
    _store: {} as Record<string, unknown>,
    _nextCalled: false,
    req: {
      path: overrides.path ?? "/ai/chat",
      method: overrides.method ?? "POST",
      header(name: string): string | undefined {
        return headers[name.toLowerCase()];
      },
    },
    json(body: unknown, status?: number): Response {
      ctx._jsonCalls.push({ body, status });
      // Return a stub Response (Hono's c.json returns a Response)
      return new Response(JSON.stringify(body), { status: status ?? 200 });
    },
    header(name: string, value: string): void {
      ctx._headers[name] = value;
    },
    set(key: string, value: unknown): void {
      ctx._store[key] = value;
    },
  };
  return ctx as typeof ctx & HonoLikeContext;
}

/** Create a next() function that succeeds. */
function fakeNext(ctx: { _nextCalled: boolean }): () => Promise<void> {
  return async () => {
    ctx._nextCalled = true;
  };
}

describe("throttle (Hono)", () => {
  let gov: Governor | null = null;

  afterEach(() => {
    gov?.dispose();
    gov = null;
  });

  it("calls next() when granted", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 5 } });
    const mw = throttle({ governor: gov });

    const ctx = fakeContext();
    await mw(ctx, fakeNext(ctx));

    expect(ctx._nextCalled).toBe(true);
  });

  it("returns 429 when denied", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });
    const mw = throttle({ governor: gov });

    // Fill the slot — use a next() that never resolves so lease stays held
    let resolveFirst!: () => void;
    const ctx1 = fakeContext();
    const p1 = mw(ctx1, () => new Promise<void>((r) => { resolveFirst = r; }));

    // Second request should be denied (slot held)
    const ctx2 = fakeContext();
    const result = await mw(ctx2, fakeNext(ctx2));

    expect(ctx2._nextCalled).toBe(false);
    expect(result).toBeInstanceOf(Response);
    expect(ctx2._jsonCalls.length).toBe(1);
    expect(ctx2._jsonCalls[0].status).toBe(429);
    expect((ctx2._jsonCalls[0].body as { reason: string }).reason).toBe("concurrency");
    expect(ctx2._headers["Retry-After"]).toBeDefined();

    // Clean up
    resolveFirst();
    await p1;
  });

  it("releases lease after next() completes", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });
    const mw = throttle({ governor: gov });

    const ctx1 = fakeContext();
    await mw(ctx1, fakeNext(ctx1));

    // Lease released — second request should succeed
    expect(gov.concurrencyAvailable).toBe(1);

    const ctx2 = fakeContext();
    await mw(ctx2, fakeNext(ctx2));
    expect(ctx2._nextCalled).toBe(true);
  });

  it("releases lease on error in next()", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });
    const mw = throttle({ governor: gov });

    const ctx1 = fakeContext();
    const failingNext = async () => {
      throw new Error("handler error");
    };

    await expect(mw(ctx1, failingNext)).rejects.toThrow("handler error");

    // Lease released — next request should succeed
    expect(gov.concurrencyAvailable).toBe(1);
  });

  it("stores leaseId on context", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 5 } });
    const mw = throttle({ governor: gov });

    const ctx = fakeContext();
    await mw(ctx, fakeNext(ctx));

    expect(ctx._store["throttleai_leaseId"]).toBeDefined();
    expect(typeof ctx._store["throttleai_leaseId"]).toBe("string");
  });

  it("uses x-actor-id header", async () => {
    const events: { actorId?: string }[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      onEvent: (e) => { if (e.type === "acquire") events.push(e); },
    });
    const mw = throttle({ governor: gov });

    const ctx = fakeContext({ headers: { "x-actor-id": "alice" } });
    await mw(ctx, fakeNext(ctx));

    expect(events[0].actorId).toBe("alice");
  });

  it("uses custom getActorId", async () => {
    const events: { actorId?: string }[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      onEvent: (e) => { if (e.type === "acquire") events.push(e); },
    });
    const mw = throttle({
      governor: gov,
      getActorId: (c) => c.req.header("x-user-id") ?? "unknown",
    });

    const ctx = fakeContext({ headers: { "x-user-id": "bob" } });
    await mw(ctx, fakeNext(ctx));

    expect(events[0].actorId).toBe("bob");
  });

  it("supports custom onDeny handler", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });
    let denyCalled = false;

    const mw = throttle({
      governor: gov,
      onDeny: (c, decision) => {
        denyCalled = true;
        return c.json({ custom: true, reason: decision.reason }, 503);
      },
    });

    // Fill slot — keep lease held
    let resolveFirst!: () => void;
    const ctx1 = fakeContext();
    const p1 = mw(ctx1, () => new Promise<void>((r) => { resolveFirst = r; }));

    // Second request triggers custom deny
    const ctx2 = fakeContext();
    await mw(ctx2, fakeNext(ctx2));

    expect(denyCalled).toBe(true);
    expect(ctx2._jsonCalls[0].status).toBe(503);
    expect((ctx2._jsonCalls[0].body as { custom: boolean }).custom).toBe(true);

    // Clean up
    resolveFirst();
    await p1;
  });
});
