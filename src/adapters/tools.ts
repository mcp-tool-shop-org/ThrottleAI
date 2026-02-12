/**
 * ThrottleAI tool adapter — wraps any async function (embeddings, rerankers, etc).
 *
 * Unifies throttling across model calls + tool calls so you can control
 * the total throughput of your AI pipeline, not just the LLM calls.
 *
 * @module throttleai/adapters/tools
 */

export type {
  AdapterGovernor,
  AdapterOptions,
  AdapterResult,
  AdapterGranted,
  AdapterDenied,
} from "./types.js";

export { classifyOutcome } from "./types.js";

import type { Priority, AcquireDecision } from "../types.js";
import type { AdapterGovernor, AdapterResult } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for wrapping a tool function. */
export interface WrapToolOptions {
  /** Governor instance. */
  governor: AdapterGovernor;
  /** Tool identifier used as the action string (e.g., "embed", "rerank"). */
  toolId: string;
  /** Actor ID (default: "default"). */
  actorId?: string;
  /** Priority (default: "background"). Tools default to background. */
  priority?: Priority;
  /** Concurrency weight for this tool (default: 1). Heavy tools consume more capacity. */
  costWeight?: number;
}

// ---------------------------------------------------------------------------
// wrapTool
// ---------------------------------------------------------------------------

/**
 * Wrap any async function with governor throttling.
 *
 * Acquires a lease (with configurable weight), runs the function,
 * and releases with outcome + latency. Useful for embeddings,
 * rerankers, vector DB calls, file operations, etc.
 *
 * ```ts
 * import { createGovernor, presets } from "throttleai";
 * import { wrapTool } from "throttleai/adapters/tools";
 *
 * const gov = createGovernor(presets.balanced());
 *
 * const embed = wrapTool(
 *   (text: string) => embeddingModel.embed(text),
 *   { governor: gov, toolId: "embed", costWeight: 1 },
 * );
 *
 * const rerank = wrapTool(
 *   (docs: string[]) => reranker.rerank(docs),
 *   { governor: gov, toolId: "rerank", costWeight: 2 },
 * );
 *
 * const embedResult = await embed("hello world");
 * if (embedResult.ok) console.log(embedResult.result);
 * ```
 */
export function wrapTool<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: WrapToolOptions,
): (...args: TArgs) => Promise<AdapterResult<TResult>> {
  const {
    governor,
    toolId,
    actorId = "default",
    priority = "background",
    costWeight = 1,
  } = options;

  return async (...args) => {
    const decision = governor.acquire({
      actorId,
      action: `tool.${toolId}`,
      priority,
      estimate: { weight: costWeight },
    });

    if (!decision.granted) {
      return {
        ok: false,
        decision: decision as AcquireDecision & { granted: false },
      };
    }

    const start = Date.now();

    try {
      const result = await fn(...args);
      const latencyMs = Date.now() - start;

      governor.release(decision.leaseId, {
        outcome: "success",
        latencyMs,
      });

      return { ok: true, result, latencyMs };
    } catch (err) {
      governor.release(decision.leaseId, {
        outcome: "error",
        latencyMs: Date.now() - start,
      });
      throw err;
    }
  };
}
