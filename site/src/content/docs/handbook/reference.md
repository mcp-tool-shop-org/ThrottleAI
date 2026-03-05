---
title: Reference
description: Troubleshooting, testing, examples, stability promise, security posture, and exit codes.
sidebar:
  order: 6
---

## Troubleshooting

### "I'm always denied" / retryAfterMs is huge

**Causes:**

1. **Leases are not being released.** Every `acquire()` must have a matching `release()`. The most common mistake is forgetting to release on error:

   ```ts
   // Bad — leak on error
   const d = gov.acquire(request);
   const result = await callModel(); // throws -> lease never released
   gov.release(d.leaseId);

   // Good — always release
   const d = gov.acquire(request);
   try {
     const result = await callModel();
     gov.release(d.leaseId, { outcome: "success" });
   } catch (err) {
     gov.release(d.leaseId, { outcome: "error" });
     throw err;
   }

   // Best — use withLease (auto-releases)
   const result = await withLease(gov, request, async () => callModel());
   ```

2. **`maxInFlight` is too low.** Check with `snapshot()`:

   ```ts
   const snap = gov.snapshot();
   console.log(snap.concurrency);
   // { inFlightWeight: 5, max: 5, effectiveMax: 5, available: 0 }
   ```

   Fix: increase `maxInFlight`, or speed up your operations so leases free faster.

3. **Rate limit exhausted.** If `reason: "rate"`, check:

   ```ts
   console.log(snap.requestRate);
   // { current: 60, limit: 60 } <-- window full
   ```

   Fix: increase the limit or use `withLease({ strategy: "wait" })` to queue.

4. **Fairness soft-cap.** If `reason: "policy"`, check the `recommendation` string for which actor hit the cap.

### "My app stalls with withLease()"

The default strategy is `"deny"` (instant). If you switched to `"wait"` or `"wait-then-deny"`, requests queue with exponential backoff.

Fix: lower `maxWaitMs` or switch to `"wait-then-deny"` with `maxAttempts: 2`.

If upstream calls are slow and `leaseTtlMs` is generous, leases hold for a long time. Set `leaseTtlMs` to just above your expected p99 latency.

### "Why is adaptive oscillating?"

The `effectiveMax` in `snapshot()` bounces up and down.

- **`adjustIntervalMs` is too short.** Increase to 10-15 seconds for bursty traffic.
- **`alpha` is too high.** Lower to 0.1 for smoother behavior.
- **Not enough traffic.** Adaptive needs ~10 requests per adjust interval to produce a stable signal. Consider disabling it for low-traffic apps.

### "What outcome should I report?"

| Outcome | When to use |
|---------|-------------|
| `"success"` | The operation completed normally |
| `"error"` | The operation failed (5xx, exception) |
| `"timeout"` | The operation timed out |
| `"cancelled"` | The operation was cancelled by the caller |

Adaptive tuning uses outcomes to judge health. A high error rate combined with high latency signals the controller to reduce concurrency. Express and Hono adapters report outcomes automatically.

### "My onEvent threw — what happens?"

Nothing bad. The governor catches errors thrown by `onEvent` callbacks. The error is silently swallowed and the acquire/release/deny operation completes normally. If you need to know about handler errors, wrap your handler in try/catch and report to your error tracker.

## Testing

### Time mocking with createTestClock

ThrottleAI uses an internal clock for all timestamp calculations. For deterministic tests, inject a fake clock:

```ts
import { createGovernor, createTestClock } from "throttleai";

const clock = createTestClock(100_000); // start at 100s

const gov = createGovernor({
  concurrency: { maxInFlight: 2 },
  rate: { requestsPerMinute: 10 },
});

// Advance time by 1 minute — rate limits reset
clock.advance(60_000);
```

`createTestClock` injects a global clock via `setNow()`. Clean up in your test teardown (or create a fresh governor per test).

Do not use `vi.useFakeTimers()` for time mocking — ThrottleAI's internal `now()` bypasses `Date.now()` when a test clock is active. However, `vi.useFakeTimers()` is fine for testing `setInterval`-based behavior like the reaper.

### Dispose in tests

Always call `gov.dispose()` in your test teardown. If you do not, the reaper `setInterval` keeps the test runner alive (or leaks across tests).

```ts
afterEach(() => {
  gov.dispose();
});
```

## Examples

The repository includes runnable examples in the `examples/` directory:

| Example | What it demonstrates |
|---------|---------------------|
| `express-adaptive/` | Full Express server with adaptive tuning + load generator |
| `node-basic.ts` | Burst simulation with snapshot printing |
| `express-middleware.ts` | 429 + retry-after endpoint |
| `cookbook-adapters.ts` | All five adapters in action |
| `cookbook-burst-snapshot.ts` | Burst load with governor snapshots |
| `cookbook-interactive-reserve.ts` | Interactive vs background priority |
| `cookbook-express-429.ts` | 429 vs queue retry pattern |

Run any example with:

```bash
npx tsx examples/node-basic.ts
```

## Stability promise

ThrottleAI follows [Semantic Versioning](https://semver.org/). The public API — everything exported from `throttleai` and `throttleai/adapters/*` — is stable as of v1.0.0. Breaking changes require a major version bump.

### What is stable

- All functions and types exported from `throttleai`
- All adapter exports from `throttleai/adapters/*`
- Config shape (`GovernorConfig` fields will not be removed or change type in v1.x)
- Event shape (`GovernorEvent` fields will not be removed; new optional fields may be added)
- Deny reasons (`concurrency`, `rate`, `budget`, `policy` are stable; new reasons may appear in minor versions)
- Adapter return shape (`{ ok: true, result, latencyMs }` / `{ ok: false, decision }`)
- Preset names (default values within presets may be tuned in minor versions)

### What is not stable

- Internal module structure (`src/pools/*`, `src/utils/*`, `src/leaseStore.ts`)
- The internal `Lease` interface
- `AdaptiveController` class (internal, exposed only through config)
- `setNow` / `resetNow` from internal time utils (use `createTestClock` instead)
- File paths within `dist/`

## Security and data scope

| Aspect | Detail |
|--------|--------|
| **Data touched** | In-memory lease state, token counters, rate windows — all ephemeral |
| **Data NOT touched** | No telemetry, no analytics, no persistent storage, no network calls, no credential handling |
| **Permissions** | Pure in-memory library — no filesystem, no network, no OS-level access |
| **Network** | None — library operates entirely in-process |
| **Telemetry** | None collected or sent |

ThrottleAI is a pure computation library. It does not make network calls, read or write files, or access any system resources. All state is in-memory and ephemeral.

For vulnerability reporting, see [SECURITY.md](https://github.com/mcp-tool-shop-org/ThrottleAI/blob/main/SECURITY.md).

## Dispose and shutdown

Call `governor.dispose()` on application shutdown to stop the TTL reaper interval.

```ts
process.on("SIGINT", () => {
  gov.dispose();
  process.exit(0);
});
```

After dispose:

- `acquire()` still works. The governor does not shut down.
- Expired leases will not be reaped until explicitly released or garbage-collected.
- `dispose()` is idempotent — calling it twice is safe.

## License

ThrottleAI is MIT licensed.
