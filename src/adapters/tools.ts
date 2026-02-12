/**
 * ThrottleAI tool adapter — wraps any async function (embeddings, rerankers, etc).
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

// Implementation added in Commit 4
