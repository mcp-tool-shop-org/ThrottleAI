/**
 * ThrottleAI Hono adapter — middleware for Hono framework.
 *
 * No dependency on Hono — this exports a plain function that
 * returns a middleware compatible with Hono's `app.use()`.
 *
 * @module throttleai/adapters/hono
 */

export type {
  AdapterGovernor,
  AdapterOptions,
} from "./types.js";

import type { AcquireRequest, AcquireDecision, Priority, TokenEstimate } from "../types.js";
import type { AdapterGovernor } from "./types.js";

// ---------------------------------------------------------------------------
// Types — minimal shapes so we don't need hono as a dependency
// ---------------------------------------------------------------------------

/** Minimal Hono-compatible context shape. */
export interface HonoLikeContext {
  req: {
    path: string;
    method: string;
    header(name: string): string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  json(body: unknown, status?: number): Response;
  header(name: string, value: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(key: string, value: any): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Options for the Hono throttle middleware. */
export interface HonoThrottleOptions {
  /** Governor instance. */
  governor: AdapterGovernor;
  /**
   * Derive the actor ID from the context (default: x-actor-id header).
   */
  getActorId?: (c: HonoLikeContext) => string;
  /**
   * Derive the action from the context (default: req.path).
   */
  getAction?: (c: HonoLikeContext) => string;
  /**
   * Derive the priority from the context (default: interactive).
   */
  getPriority?: (c: HonoLikeContext) => Priority;
  /**
   * Derive a token estimate from the context (optional).
   */
  getEstimate?: (c: HonoLikeContext) => TokenEstimate | undefined;
  /**
   * Custom handler for denied requests.
   * Return a Response to override the default 429 JSON.
   */
  onDeny?: (
    c: HonoLikeContext,
    decision: AcquireDecision & { granted: false },
  ) => Response;
}

// ---------------------------------------------------------------------------
// throttle (Hono middleware)
// ---------------------------------------------------------------------------

/**
 * Create a Hono middleware that throttles requests via the governor.
 *
 * ```ts
 * import { Hono } from "hono";
 * import { createGovernor, presets } from "throttleai";
 * import { throttle } from "throttleai/adapters/hono";
 *
 * const gov = createGovernor(presets.balanced());
 * const app = new Hono();
 *
 * app.use("/ai/*", throttle({ governor: gov }));
 *
 * app.post("/ai/chat", (c) => c.json({ message: "ok" }));
 * ```
 */
export function throttle(
  options: HonoThrottleOptions,
): (c: HonoLikeContext, next: () => Promise<void>) => Response | Promise<void | Response> {
  const {
    governor,
    getActorId,
    getAction,
    getPriority,
    getEstimate,
    onDeny,
  } = options;

  return async (c, next) => {
    const actorId = getActorId
      ? getActorId(c)
      : (c.req.header("x-actor-id") ?? "anonymous");

    const request: AcquireRequest = {
      actorId,
      action: getAction ? getAction(c) : c.req.path,
      priority: getPriority ? getPriority(c) : "interactive",
      estimate: getEstimate ? getEstimate(c) : undefined,
    };

    const decision = governor.acquire(request);

    if (!decision.granted) {
      if (onDeny) {
        return onDeny(c, decision as AcquireDecision & { granted: false });
      }

      c.header("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)));
      return c.json(
        {
          error: "Too many requests",
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
          recommendation: decision.recommendation,
        },
        429,
      );
    }

    // Store leaseId on context for downstream release
    const leaseId = decision.leaseId;
    c.set("throttleai_leaseId", leaseId);

    try {
      await next();
      governor.release(leaseId, { outcome: "success" });
    } catch (err) {
      governor.release(leaseId, { outcome: "error" });
      throw err;
    }
  };
}
