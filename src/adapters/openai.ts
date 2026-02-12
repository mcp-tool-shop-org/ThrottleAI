/**
 * ThrottleAI OpenAI-compatible adapter — wraps any OpenAI-compatible API call.
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

// Implementation added in Commit 3
