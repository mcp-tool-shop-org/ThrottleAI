import { describe, it, expect, afterEach } from "vitest";
import { createGovernor } from "../../src/createGovernor.js";
import { throttleMiddleware } from "../../src/adapters/express.js";
import type { Governor } from "../../src/governor.js";
import type {
  ExpressLikeRequest,
  ExpressLikeResponse,
} from "../../src/adapters/express.js";

/** Create a fake Express request. */
function fakeReq(overrides: Partial<ExpressLikeRequest> = {}): ExpressLikeRequest {
  return {
    path: "/ai/chat",
    method: "POST",
    ip: "127.0.0.1",
    headers: {},
    ...overrides,
  };
}

/** Create a fake Express response with tracking. */
function fakeRes(): ExpressLikeResponse & {
  _status: number;
  _body: unknown;
  _headers: Record<string, string | number>;
  _listeners: Record<string, (() => void)[]>;
  triggerFinish: () => void;
} {
  const res = {
    _status: 200,
    _body: null as unknown,
    _headers: {} as Record<string, string | number>,
    _listeners: {} as Record<string, (() => void)[]>,
    statusCode: 200,
    status(code: number) {
      res._status = code;
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res._body = body;
    },
    setHeader(name: string, value: string | number) {
      res._headers[name] = value;
    },
    on(event: string, listener: () => void) {
      if (!res._listeners[event]) res._listeners[event] = [];
      res._listeners[event].push(listener);
    },
    triggerFinish() {
      for (const fn of res._listeners["finish"] ?? []) fn();
    },
  };
  return res as typeof res & ExpressLikeResponse;
}

describe("throttleMiddleware (Express)", () => {
  let gov: Governor | null = null;

  afterEach(() => {
    gov?.dispose();
    gov = null;
  });

  it("calls next() when granted", () => {
    gov = createGovernor({ concurrency: { maxInFlight: 5 } });
    const mw = throttleMiddleware({ governor: gov });

    let nextCalled = false;
    const req = fakeReq();
    const res = fakeRes();

    mw(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  it("returns 429 when denied", () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });
    const mw = throttleMiddleware({ governor: gov });

    // Fill the slot
    const req1 = fakeReq();
    const res1 = fakeRes();
    mw(req1, res1, () => {});

    // Second request should be denied
    const req2 = fakeReq();
    const res2 = fakeRes();
    let nextCalled = false;
    mw(req2, res2, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res2._status).toBe(429);
    expect((res2._body as { reason: string }).reason).toBe("concurrency");
    expect(res2._headers["Retry-After"]).toBeDefined();
  });

  it("releases lease on response finish", () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });
    const mw = throttleMiddleware({ governor: gov });

    const req1 = fakeReq();
    const res1 = fakeRes();
    mw(req1, res1, () => {});

    // Slot is full
    expect(gov.concurrencyAvailable).toBe(0);

    // Trigger finish → lease released
    res1.triggerFinish();
    expect(gov.concurrencyAvailable).toBe(1);
  });

  it("uses x-actor-id header", () => {
    const events: { actorId?: string }[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      onEvent: (e) => { if (e.type === "acquire") events.push(e); },
    });
    const mw = throttleMiddleware({ governor: gov });

    const req = fakeReq({ headers: { "x-actor-id": "alice" } });
    mw(req, fakeRes(), () => {});

    expect(events[0].actorId).toBe("alice");
  });

  it("uses custom getActorId", () => {
    const events: { actorId?: string }[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      onEvent: (e) => { if (e.type === "acquire") events.push(e); },
    });
    const mw = throttleMiddleware({
      governor: gov,
      getActorId: (req) => req.headers["x-user-id"] as string ?? "unknown",
    });

    const req = fakeReq({ headers: { "x-user-id": "bob" } });
    mw(req, fakeRes(), () => {});

    expect(events[0].actorId).toBe("bob");
  });

  it("supports custom onDeny handler", () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });
    let denyCalled = false;

    const mw = throttleMiddleware({
      governor: gov,
      onDeny: (_req, res, decision) => {
        denyCalled = true;
        res.status(503).json({ custom: true, reason: decision.reason });
      },
    });

    // Fill slot
    mw(fakeReq(), fakeRes(), () => {});

    // Second request triggers custom deny
    const res2 = fakeRes();
    mw(fakeReq(), res2, () => {});

    expect(denyCalled).toBe(true);
    expect(res2._status).toBe(503);
    expect((res2._body as { custom: boolean }).custom).toBe(true);
  });
});
