// ThrottleAI — lightweight, token-based AI governance

// Factory
export { createGovernor } from "./createGovernor.js";

// Governor class
export { Governor } from "./governor.js";

// Helper
export { withLease } from "./withLease.js";
export type { WithLeaseOptions, WithLeaseResult, WithLeaseStrategy } from "./withLease.js";

// Retry helpers
export { waitForRetry, retryAcquire } from "./retry.js";

// Presets
export { presets } from "./presets.js";

// Testing utilities
export { createTestClock } from "./utils/time.js";
export type { Clock } from "./utils/time.js";

// Types
export type {
  GovernorConfig,
  ConcurrencyConfig,
  RateConfig,
  FairnessConfig,
  AdaptiveConfig,
  AcquireRequest,
  AcquireDecision,
  ReleaseReport,
  DenyReason,
  LeaseOutcome,
  Priority,
  TokenEstimate,
  Constraints,
  LimitsHint,
  GovernorSnapshot,
  GovernorEvent,
  GovernorEventType,
  GovernorEventHandler,
} from "./types.js";
