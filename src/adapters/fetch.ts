/**
 * ThrottleAI fetch adapter — wraps any fetch-compatible function.
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

// Implementation added in Commit 2
