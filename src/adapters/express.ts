/**
 * ThrottleAI Express adapter — drop-in middleware.
 *
 * No dependency on Express — this exports a plain function that
 * returns `(req, res, next)`. You already have Express installed.
 *
 * @module throttleai/adapters/express
 */

export type {
  AdapterGovernor,
  AdapterOptions,
} from "./types.js";

import type { AcquireRequest, AcquireDecision, Priority, TokenEstimate } from "../types.js";
import type { AdapterGovernor } from "./types.js";

// ---------------------------------------------------------------------------
// Types — use minimal shapes so we don't need @types/express
// ---------------------------------------------------------------------------

/** Minimal Express-compatible request shape. */
export interface ExpressLikeRequest {
  path: string;
  method: string;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Minimal Express-compatible response shape. */
export interface ExpressLikeResponse {
  status(code: number): this;
  json(body: unknown): void;
  setHeader(name: string, value: string | number): void;
  on(event: string, listener: () => void): void;
  statusCode?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Options for the Express throttle middleware. */
export interface ThrottleMiddlewareOptions {
  /** Governor instance. */
  governor: AdapterGovernor;
  /**
   * Derive the actor ID from the request (default: x-actor-id header or req.ip).
   */
  getActorId?: (req: ExpressLikeRequest) => string;
  /**
   * Derive the action from the request (default: req.path).
   */
  getAction?: (req: ExpressLikeRequest) => string;
  /**
   * Derive the priority from the request (default: interactive).
   */
  getPriority?: (req: ExpressLikeRequest) => Priority;
  /**
   * Derive a token estimate from the request (optional).
   */
  getEstimate?: (req: ExpressLikeRequest) => TokenEstimate | undefined;
  /**
   * Custom handler for denied requests (default: 429 JSON response).
   */
  onDeny?: (
    req: ExpressLikeRequest,
    res: ExpressLikeResponse,
    decision: AcquireDecision & { granted: false },
  ) => void;
}

// ---------------------------------------------------------------------------
// throttleMiddleware
// ---------------------------------------------------------------------------

/**
 * Create an Express middleware that throttles requests via the governor.
 *
 * ```ts
 * import express from "express";
 * import { createGovernor, presets } from "throttleai";
 * import { throttleMiddleware } from "throttleai/adapters/express";
 *
 * const gov = createGovernor(presets.balanced());
 * const app = express();
 *
 * app.use("/ai", throttleMiddleware({ governor: gov }));
 *
 * app.post("/ai/chat", (req, res) => {
 *   // This only runs if the governor granted a lease
 *   res.json({ message: "ok" });
 * });
 * ```
 */
export function throttleMiddleware(
  options: ThrottleMiddlewareOptions,
): (req: ExpressLikeRequest, res: ExpressLikeResponse, next: () => void) => void {
  const {
    governor,
    getActorId,
    getAction,
    getPriority,
    getEstimate,
    onDeny,
  } = options;

  return (req, res, next) => {
    const actorId = getActorId
      ? getActorId(req)
      : (asString(req.headers["x-actor-id"]) ?? req.ip ?? "anonymous");

    const request: AcquireRequest = {
      actorId,
      action: getAction ? getAction(req) : req.path,
      priority: getPriority ? getPriority(req) : "interactive",
      estimate: getEstimate ? getEstimate(req) : undefined,
    };

    const decision = governor.acquire(request);

    if (!decision.granted) {
      if (onDeny) {
        onDeny(req, res, decision as AcquireDecision & { granted: false });
        return;
      }

      // Default: 429 JSON response
      res.setHeader("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)));
      res.status(429).json({
        error: "Too many requests",
        reason: decision.reason,
        retryAfterMs: decision.retryAfterMs,
        recommendation: decision.recommendation,
      });
      return;
    }

    // Release lease when response finishes
    const leaseId = decision.leaseId;
    res.on("finish", () => {
      governor.release(leaseId, {
        outcome: (res.statusCode ?? 200) < 400 ? "success" : "error",
      });
    });

    next();
  };
}

/** Safely convert a header value to string. */
function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
