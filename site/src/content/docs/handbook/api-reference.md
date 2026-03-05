---
title: API Reference
description: Complete API reference for ThrottleAI — createGovernor, acquire, release, withLease, snapshot, formatters, and dispose.
sidebar:
  order: 4
---

## Main entry point

Everything documented here is exported from `throttleai` and is part of the stable public API. Breaking changes require a major version bump.

## createGovernor(config): Governor

Factory function. Creates and returns a `Governor` instance with the provided configuration.

```ts
import { createGovernor, presets } from "throttleai";

const gov = createGovernor(presets.balanced());
```

See [Configuration](/ThrottleAI/handbook/configuration/) for the full config reference.

## governor.acquire(request): AcquireDecision

Request a lease from the governor. Returns synchronously with an immediate decision.

### Request shape

```ts
interface AcquireRequest {
  actorId: string;              // identifies the caller
  action: string;               // what they are doing ("chat", "embed", etc.)
  priority?: "interactive" | "background"; // default: "interactive"
  weight?: number;              // concurrency weight (default: 1)
  estimatedTokens?: number;     // for token-rate checking
}
```

### Return shape

```ts
// Granted
{
  granted: true,
  leaseId: string,
  expiresAt: number,   // Unix timestamp (ms)
}

// Denied
{
  granted: false,
  reason: DenyReason,
  retryAfterMs: number,
  recommendation: string,  // human-readable suggestion
  limitsHint?: LimitsHint, // which limit was hit and current values
}
```

### Deny reasons

| Reason | Meaning |
|--------|---------|
| `"concurrency"` | All slots are in use (or interactive reserve blocks background) |
| `"rate"` | `requestsPerMinute` or `tokensPerMinute` limit reached |
| `"budget"` | Token budget exhausted |
| `"policy"` | Fairness soft-cap prevents this actor from acquiring more slots |

## governor.release(leaseId, report?): void

Release a previously acquired lease. Always call this, even on errors.

```ts
gov.release(decision.leaseId, {
  outcome: "success",      // "success" | "error" | "timeout" | "cancelled"
  latencyMs: 1200,         // optional: actual call duration
  tokensUsed: 500,         // optional: actual token consumption
});
```

The report object is optional but strongly recommended. Adaptive tuning and stats collection use outcome and latency data to make better decisions.

### Outcome values

| Outcome | When to use |
|---------|-------------|
| `"success"` | The operation completed normally |
| `"error"` | The operation failed (5xx, exception, etc.) |
| `"timeout"` | The operation timed out |
| `"cancelled"` | The operation was cancelled by the caller |

In strict mode (`strict: true`), releasing an unknown or already-released lease throws an error. In normal mode, it is silently ignored.

## withLease(governor, request, fn, options?)

Execute an async function under a lease with automatic acquire and release. This is the recommended way to use ThrottleAI for most cases.

```ts
import { withLease } from "throttleai";

const result = await withLease(gov, request, async () => {
  return await callMyModel();
});

if (result.granted) {
  console.log(result.result);
} else {
  console.log("Denied:", result.decision.recommendation);
}
```

### Options

```ts
interface WithLeaseOptions {
  strategy?: WithLeaseStrategy;   // "deny" | "wait" | "wait-then-deny"
  maxWaitMs?: number;             // max total wait (default: 10_000)
  maxAttempts?: number;           // for "wait-then-deny" (default: 3)
  initialBackoffMs?: number;      // starting backoff (default: 250)
}
```

### Strategies

| Strategy | Behavior |
|----------|----------|
| `"deny"` | Fail immediately if denied. Default. |
| `"wait"` | Retry with exponential backoff until `maxWaitMs`. |
| `"wait-then-deny"` | Retry up to `maxAttempts` within `maxWaitMs`, then deny. |

### Return shape

```ts
// Granted
{ granted: true, result: T, latencyMs: number }

// Denied
{ granted: false, decision: AcquireDecision }
```

## governor.snapshot(): GovernorSnapshot

Returns a point-in-time view of the governor's state. Useful for dashboards, health checks, and debugging.

```ts
const snap = gov.snapshot();
```

### Snapshot shape

```ts
interface GovernorSnapshot {
  concurrency: {
    inFlightWeight: number;
    max: number;
    effectiveMax: number;  // after adaptive adjustment
    available: number;
  };
  requestRate: {
    current: number;
    limit: number;
  };
  tokenRate: {
    current: number;
    limit: number;
  };
  leases: {
    active: number;
    lastDenyReason?: DenyReason;
    lastDenyTime?: number;
  };
}
```

## formatEvent(event): string

One-line human-readable formatter for governor events.

```ts
import { formatEvent } from "throttleai";

const gov = createGovernor({
  onEvent: (e) => console.log(formatEvent(e)),
});
// [deny] actor=user-1 action=chat reason=concurrency retryAfterMs=500
```

## formatSnapshot(snap): string

Compact one-line formatter for snapshots.

```ts
import { formatSnapshot } from "throttleai";

console.log(formatSnapshot(gov.snapshot()));
// concurrency=3/5 rate=12/60 leases=3
```

## Status getters

Convenience properties on the governor instance for quick checks without calling `snapshot()`.

```ts
gov.activeLeases         // number — active lease count
gov.concurrencyActive    // number — in-flight weight
gov.concurrencyAvailable // number — remaining capacity
gov.rateCount            // number — requests in current window
gov.tokenRateCount       // number — tokens in current window
```

## governor.dispose(): void

Stops the TTL reaper interval. Call on application shutdown.

```ts
process.on("SIGINT", () => {
  gov.dispose();
  process.exit(0);
});
```

After dispose:

- `acquire()` still works. The governor does not shut down — it just stops sweeping expired leases.
- Expired leases will not be reaped. They sit until explicitly released or the governor is garbage-collected.
- `dispose()` is idempotent. Calling it twice is safe.

If you do not call dispose, the reaper `setInterval` keeps the Node.js process alive.

## Utility functions

### waitForRetry(decision): Promise\<void\>

Sleeps for the `retryAfterMs` duration from a deny decision. Useful for manual retry loops.

### retryAcquire(governor, request, options): Promise\<AcquireDecision\>

Retry acquire with backoff. Used internally by `withLease` but available for custom retry logic.

### createStatsCollector(): StatsCollector

Returns a zero-dependency stats collector that you can wire to `onEvent`:

```ts
const stats = createStatsCollector();
const gov = createGovernor({
  onEvent: stats.handler,
});

const summary = stats.snapshot();
// { grants: 150, denies: 12, avgLatencyMs: 340, ... }
```

### createTestClock(startMs): Clock

Creates a deterministic clock for testing. Inject it to control time in tests:

```ts
import { createTestClock } from "throttleai";

const clock = createTestClock(100_000); // start at 100s
// Advance time by 1 minute
clock.advance(60_000);
```

## Exported types

All types are exported from `throttleai`:

- **Config:** `GovernorConfig`, `ConcurrencyConfig`, `RateConfig`, `FairnessConfig`, `AdaptiveConfig`
- **Request/Response:** `AcquireRequest`, `AcquireDecision`, `ReleaseReport`
- **Enums:** `DenyReason`, `LeaseOutcome`, `Priority`, `TokenEstimate`
- **State:** `Constraints`, `LimitsHint`, `GovernorSnapshot`
- **Events:** `GovernorEvent`, `GovernorEventType`, `GovernorEventHandler`
- **WithLease:** `WithLeaseOptions`, `WithLeaseResult`, `WithLeaseStrategy`
- **Stats:** `StatsCollector`, `StatsSnapshot`
- **Clock:** `Clock`
