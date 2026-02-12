// ---------------------------------------------------------------------------
// Public configuration
// ---------------------------------------------------------------------------

export interface ConcurrencyConfig {
  /** Maximum number of in-flight leases. */
  maxInFlight: number;
  /** Slots reserved for interactive priority (default 0). */
  interactiveReserve?: number;
}

export interface RateConfig {
  /** Maximum requests allowed within the rolling window. */
  requestsPerMinute: number;
  /** Rolling window size in ms (default 60 000). */
  windowMs?: number;
}

export interface GovernorConfig {
  concurrency?: ConcurrencyConfig;
  rate?: RateConfig;
  /** Lease time-to-live in ms (default 60 000). */
  leaseTtlMs?: number;
  /** How often the reaper sweeps expired leases in ms (default 5 000). */
  reaperIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Request / decision
// ---------------------------------------------------------------------------

export type Priority = "interactive" | "background";

export type DenyReason = "concurrency" | "rate" | "budget" | "policy";

export type LeaseOutcome = "success" | "error" | "timeout" | "cancelled";

export interface TokenEstimate {
  promptTokens?: number;
  maxOutputTokens?: number;
  /** Concurrency weight for this call (default 1). Heavy calls consume more capacity. */
  weight?: number;
}

export interface AcquireRequest {
  actorId: string;
  action: string;
  estimate?: TokenEstimate;
  idempotencyKey?: string;
  priority?: Priority;
}

export interface Constraints {
  maxOutputTokens?: number;
}

export type AcquireDecision =
  | {
      granted: true;
      leaseId: string;
      expiresAt: number;
      constraints?: Constraints;
    }
  | {
      granted: false;
      reason: DenyReason;
      retryAfterMs: number;
      recommendation: string;
    };

export interface ReleaseReport {
  outcome: LeaseOutcome;
  usage?: { promptTokens?: number; outputTokens?: number };
  actualCostCents?: number;
}

// ---------------------------------------------------------------------------
// Internal lease record
// ---------------------------------------------------------------------------

export interface Lease {
  leaseId: string;
  actorId: string;
  action: string;
  priority: Priority;
  expiresAt: number;
  estimate?: TokenEstimate;
  idempotencyKey?: string;
  createdAt: number;
  /** Concurrency weight consumed by this lease (default 1). */
  weight: number;
}
