/**
 * Shared types for all ThrottleAI adapters.
 *
 * Adapters live in separate entrypoints so bundlers can tree-shake them.
 * Core ThrottleAI never imports from adapters.
 */

import type { Governor } from "../governor.js";
import type { Priority, LeaseOutcome, AcquireDecision } from "../types.js";

// ---------------------------------------------------------------------------
// Adapter context — what every adapter needs
// ---------------------------------------------------------------------------

/** Minimal governor interface that adapters depend on. */
export interface AdapterGovernor {
  acquire: Governor["acquire"];
  release: Governor["release"];
}

/** Options common to all adapters. */
export interface AdapterOptions {
  /** Governor instance to use for throttling. */
  governor: AdapterGovernor;
  /** Actor ID for the request (default: "default"). */
  actorId?: string;
  /** Priority for the request (default: "interactive"). */
  priority?: Priority;
}

// ---------------------------------------------------------------------------
// Adapter result — consistent deny shape across all adapters
// ---------------------------------------------------------------------------

/** Successful adapter result. */
export interface AdapterGranted<T> {
  ok: true;
  result: T;
  latencyMs: number;
}

/** Denied adapter result — consistent shape across all adapters. */
export interface AdapterDenied {
  ok: false;
  decision: AcquireDecision & { granted: false };
}

/** Union result from any adapter. */
export type AdapterResult<T> = AdapterGranted<T> | AdapterDenied;

// ---------------------------------------------------------------------------
// Usage extraction — optional hook for adapters to report actual tokens
// ---------------------------------------------------------------------------

/** Token usage as reported by a provider response. */
export interface ProviderUsage {
  promptTokens?: number;
  outputTokens?: number;
}

/** Classify the outcome of an operation. */
export function classifyOutcome(
  error: unknown,
  statusCode?: number,
): LeaseOutcome {
  if (error) return "error";
  if (statusCode !== undefined && statusCode >= 400) return "error";
  return "success";
}
