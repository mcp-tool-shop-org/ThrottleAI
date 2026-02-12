/**
 * ThrottleAI fetch adapter — wraps any fetch-compatible function.
 *
 * Works with Node 18+ global `fetch`, `undici`, or any custom fetch.
 * Acquires a governor lease before calling fetch and releases after.
 *
 * @module throttleai/adapters/fetch
 */

export type {
  AdapterGovernor,
  AdapterOptions,
  AdapterResult,
  AdapterGranted,
  AdapterDenied,
  ProviderUsage,
} from "./types.js";

export { classifyOutcome } from "./types.js";

import type { Priority, TokenEstimate, AcquireDecision } from "../types.js";
import type { AdapterGovernor, ProviderUsage } from "./types.js";
import { classifyOutcome } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Any function with the standard fetch signature. */
export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Options for `wrapFetch`. */
export interface WrapFetchOptions {
  /** Governor instance. */
  governor: AdapterGovernor;
  /** Actor ID (default: "default"). */
  actorId?: string;
  /** Priority (default: "interactive"). */
  priority?: Priority;
  /** Derive action string from the request (default: URL pathname). */
  classifyAction?: (input: string | URL | Request, init?: RequestInit) => string;
  /** Provide a token estimate for the request. */
  estimate?: (input: string | URL | Request, init?: RequestInit) => TokenEstimate;
  /** Extract actual usage from the parsed response body (optional). */
  extractUsage?: (body: unknown) => ProviderUsage | undefined;
}

/** Result from a throttled fetch call. */
export type ThrottledFetchResult =
  | { ok: true; response: Response; latencyMs: number }
  | { ok: false; decision: AcquireDecision & { granted: false } };

// ---------------------------------------------------------------------------
// wrapFetch
// ---------------------------------------------------------------------------

/**
 * Wrap a fetch function with governor throttling.
 *
 * Returns a new function with the same signature that acquires a lease
 * before calling fetch and releases after.
 *
 * ```ts
 * import { createGovernor, presets } from "throttleai";
 * import { wrapFetch } from "throttleai/adapters/fetch";
 *
 * const gov = createGovernor(presets.balanced());
 * const throttledFetch = wrapFetch(fetch, { governor: gov });
 *
 * const result = await throttledFetch("https://api.example.com/v1/chat", {
 *   method: "POST",
 *   body: JSON.stringify({ prompt: "Hello" }),
 * });
 *
 * if (result.ok) {
 *   const data = await result.response.json();
 * } else {
 *   console.log("Throttled:", result.decision.recommendation);
 * }
 * ```
 */
export function wrapFetch(
  fetchFn: FetchFn,
  options: WrapFetchOptions,
): (input: string | URL | Request, init?: RequestInit) => Promise<ThrottledFetchResult> {
  const {
    governor,
    actorId = "default",
    priority = "interactive",
    classifyAction,
    estimate,
  } = options;

  return async (input, init?) => {
    const action = classifyAction
      ? classifyAction(input, init)
      : deriveAction(input);

    const decision = governor.acquire({
      actorId,
      action,
      priority,
      estimate: estimate?.(input, init),
    });

    if (!decision.granted) {
      return {
        ok: false,
        decision: decision as AcquireDecision & { granted: false },
      };
    }

    const start = Date.now();
    let error: unknown = null;
    let response: Response | undefined;

    try {
      response = await fetchFn(input, init);
      return {
        ok: true,
        response,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      error = err;
      throw err;
    } finally {
      const latencyMs = Date.now() - start;
      const outcome = classifyOutcome(error, response?.status);

      governor.release(decision.leaseId, {
        outcome,
        latencyMs,
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive an action string from a fetch input (uses URL pathname). */
function deriveAction(input: string | URL | Request): string {
  try {
    if (typeof input === "string") {
      return new URL(input).pathname;
    }
    if (input instanceof URL) {
      return input.pathname;
    }
    // Request object
    return new URL(input.url).pathname;
  } catch {
    return "fetch";
  }
}
