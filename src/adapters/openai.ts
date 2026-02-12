/**
 * ThrottleAI OpenAI-compatible adapter.
 *
 * Wraps any OpenAI-compatible API call (chat completions, embeddings, etc.)
 * with governor throttling. No dependency on any OpenAI SDK.
 *
 * @module throttleai/adapters/openai
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

import type { Priority, AcquireDecision } from "../types.js";
import type { AdapterGovernor, ProviderUsage } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the OpenAI-compatible adapter. */
export interface OpenAIAdapterOptions {
  /** Governor instance. */
  governor: AdapterGovernor;
  /** Actor ID (default: "default"). */
  actorId?: string;
  /** Priority (default: "interactive"). */
  priority?: Priority;
  /** Action string (default: "chat.completions"). */
  action?: string;
}

/** OpenAI-compatible usage object (as returned by many providers). */
export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** Minimal shape of an OpenAI-compatible response (works with any SDK). */
export interface OpenAILikeResponse {
  usage?: OpenAIUsage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Result from a throttled OpenAI call. */
export type ThrottledOpenAIResult<T> =
  | { ok: true; result: T; usage?: ProviderUsage; latencyMs: number }
  | { ok: false; decision: AcquireDecision & { granted: false } };

// ---------------------------------------------------------------------------
// wrapChatCompletions
// ---------------------------------------------------------------------------

/**
 * Wrap an OpenAI-compatible chat completions call with governor throttling.
 *
 * The `createFn` is any async function that calls the API and returns the
 * response. This adapter is SDK-agnostic — it works with the official
 * OpenAI SDK, Anthropic, Together, Ollama, or any compatible client.
 *
 * ```ts
 * import { createGovernor, presets } from "throttleai";
 * import { wrapChatCompletions } from "throttleai/adapters/openai";
 * import OpenAI from "openai";
 *
 * const gov = createGovernor(presets.balanced());
 * const client = new OpenAI();
 *
 * const throttled = wrapChatCompletions(
 *   (params) => client.chat.completions.create(params),
 *   { governor: gov, actorId: "user-123" },
 * );
 *
 * const result = await throttled({
 *   model: "gpt-4",
 *   messages: [{ role: "user", content: "Hello" }],
 * });
 *
 * if (result.ok) {
 *   console.log(result.result.choices[0].message.content);
 *   console.log("Tokens:", result.usage);
 * }
 * ```
 */
export function wrapChatCompletions<TParams, TResponse extends OpenAILikeResponse>(
  createFn: (params: TParams) => Promise<TResponse>,
  options: OpenAIAdapterOptions,
): (params: TParams, estimate?: { promptTokens?: number; maxOutputTokens?: number }) => Promise<ThrottledOpenAIResult<TResponse>> {
  const {
    governor,
    actorId = "default",
    priority = "interactive",
    action = "chat.completions",
  } = options;

  return async (params, estimate?) => {
    const decision = governor.acquire({
      actorId,
      action,
      priority,
      estimate: estimate
        ? { promptTokens: estimate.promptTokens, maxOutputTokens: estimate.maxOutputTokens }
        : undefined,
    });

    if (!decision.granted) {
      return {
        ok: false,
        decision: decision as AcquireDecision & { granted: false },
      };
    }

    const start = Date.now();

    try {
      const result = await createFn(params);
      const latencyMs = Date.now() - start;

      // Extract usage from response
      const usage = extractUsage(result);

      governor.release(decision.leaseId, {
        outcome: "success",
        latencyMs,
        usage,
      });

      return { ok: true, result, usage, latencyMs };
    } catch (err) {
      governor.release(decision.leaseId, {
        outcome: "error",
        latencyMs: Date.now() - start,
      });
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// Estimation helpers
// ---------------------------------------------------------------------------

/**
 * Rough token estimate from character count.
 *
 * Uses the common ~4 chars/token heuristic. This is intentionally simple
 * and clearly labeled as an estimate. For accurate counts, use a real
 * tokenizer (tiktoken, etc.) and pass the result as `estimate`.
 */
export function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(charCount / 4);
}

/**
 * Estimate tokens from an array of chat messages.
 *
 * Sums character counts of all message `content` strings and applies
 * the ~4 chars/token heuristic. Per-message overhead (~4 tokens) is added.
 */
export function estimateTokensFromMessages(
  messages: Array<{ role: string; content?: string | null }>,
): number {
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += (msg.content?.length ?? 0) + msg.role.length;
  }
  // ~4 tokens per message for metadata overhead
  return estimateTokensFromChars(totalChars) + messages.length * 4;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Extract ProviderUsage from an OpenAI-compatible response. */
function extractUsage(response: OpenAILikeResponse): ProviderUsage | undefined {
  const u = response.usage;
  if (!u) return undefined;
  return {
    promptTokens: u.prompt_tokens,
    outputTokens: u.completion_tokens,
  };
}
