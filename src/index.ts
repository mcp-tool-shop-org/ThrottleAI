// ThrottleAI — lightweight, token-based AI governance

// Factory
export { createGovernor } from "./createGovernor.js";

// Governor class
export { Governor } from "./governor.js";

// Helper
export { withLease } from "./withLease.js";
export type { WithLeaseOptions, WithLeaseResult } from "./withLease.js";

// Types
export type {
  GovernorConfig,
  ConcurrencyConfig,
  RateConfig,
  FairnessConfig,
  AcquireRequest,
  AcquireDecision,
  ReleaseReport,
  DenyReason,
  LeaseOutcome,
  Priority,
  TokenEstimate,
  Constraints,
} from "./types.js";
