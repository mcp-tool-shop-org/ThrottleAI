# Troubleshooting

Common issues and how to fix them.

---

## "I'm always denied" / retryAfterMs is huge

**Symptoms:** Every `acquire()` returns `granted: false`. The `retryAfterMs` value is thousands of milliseconds.

**Causes:**

1. **Leases aren't being released.** The most common cause. Every `acquire()` must have a matching `release()`.

   ```ts
   // ✗ Bad — leak on error
   const d = gov.acquire(request);
   const result = await callModel(); // throws → lease never released
   gov.release(d.leaseId);

   // ✓ Good — always release
   const d = gov.acquire(request);
   try {
     const result = await callModel();
     gov.release(d.leaseId, { outcome: "success" });
   } catch (err) {
     gov.release(d.leaseId, { outcome: "error" });
     throw err;
   }

   // ✓ Best — use withLease (auto-releases)
   const result = await withLease(gov, request, async () => callModel());
   ```

2. **`maxInFlight` is too low for your traffic.** Check with `snapshot()`:

   ```ts
   const snap = gov.snapshot();
   console.log(snap.concurrency);
   // { inFlightWeight: 5, max: 5, effectiveMax: 5, available: 0 }
   //                                                ^^^^^^^^^^^^ no capacity
   ```

   Fix: increase `maxInFlight`, or speed up your operations so leases free faster.

3. **Rate limit exhausted.** If `reason: "rate"`, you're hitting `requestsPerMinute` or `tokensPerMinute`:

   ```ts
   const snap = gov.snapshot();
   console.log(snap.requestRate);
   // { current: 60, limit: 60 } ← window full
   ```

   Fix: increase the limit, or use `withLease({ strategy: "wait" })` to queue requests.

4. **Fairness soft-cap.** If `reason: "policy"`, one actor is hitting the fairness cap. Check the `recommendation` string — it tells you which actor and the cap.

---

## "My app stalls with withLease()"

**Symptoms:** `withLease()` hangs for the full `maxWaitMs` before eventually returning `granted: false`.

**Causes:**

1. **Strategy mismatch.** The default strategy is `"deny"` (instant). If you switched to `"wait"` or `"wait-then-deny"`, requests queue with exponential backoff:

   ```ts
   // This will wait up to 10 seconds before giving up
   await withLease(gov, request, fn, {
     strategy: "wait",
     maxWaitMs: 10_000,
   });
   ```

   Fix: lower `maxWaitMs` or switch to `"wait-then-deny"` with `maxAttempts: 2` for bounded retries.

2. **Upstream is slow + leases hold too long.** If the model call takes 30 seconds but your `leaseTtlMs` is 60 seconds, leases sit for a long time. Combine with low `maxInFlight` and requests queue up.

   Fix: set `leaseTtlMs` to just above your expected p99 latency.

---

## "Why is adaptive oscillating?"

**Symptoms:** `effectiveMax` in `snapshot()` bounces up and down every few seconds.

**Causes:**

1. **`adjustIntervalMs` is too short.** The default (5 seconds) works for steady traffic. For bursty traffic, increase to 10-15 seconds:

   ```ts
   adaptive: { adjustIntervalMs: 15_000 }
   ```

2. **`alpha` is too high.** The EMA smoothing factor (default 0.2) controls how fast the signal changes. Lower it for smoother behavior:

   ```ts
   adaptive: { alpha: 0.1 }
   ```

3. **Not enough traffic.** Adaptive needs a steady stream of latency samples to work well. With fewer than ~10 requests per adjust interval, the signal is noisy. Consider disabling adaptive for low-traffic apps.

---

## "What outcome should I report?"

When calling `release()`, report the outcome of the operation:

| Outcome | When to use |
|---------|-------------|
| `"success"` | The operation completed normally |
| `"error"` | The operation failed (5xx, exception, etc.) |
| `"timeout"` | The operation timed out |
| `"cancelled"` | The operation was cancelled by the caller |

**Why it matters:** Adaptive tuning uses outcomes to judge health. A high error rate combined with high latency signals the controller to reduce concurrency.

If you're using the Express or Hono adapter, outcomes are reported automatically based on the HTTP status code (`< 400` → success, `≥ 400` → error).

---

## "Time mocking in tests (createTestClock)"

ThrottleAI uses an internal clock for all timestamp calculations. For deterministic tests, inject a fake clock:

```ts
import { createGovernor, createTestClock } from "throttleai";

const clock = createTestClock(100_000); // start at 100s

const gov = createGovernor({
  concurrency: { maxInFlight: 2 },
  rate: { requestsPerMinute: 10 },
});

// Advance time by 1 minute
clock.advance(60_000);

// Now rate limits have reset
```

**Important:** `createTestClock` injects a global clock via `setNow()`. Call `resetNow()` in your test teardown (or use `afterEach`) to restore real time:

```ts
import { createTestClock } from "throttleai";
// In vitest:
afterEach(() => {
  // createTestClock doesn't auto-reset — clean up manually
  // or just create a fresh governor per test
});
```

**Don't use `vi.useFakeTimers()` for time mocking** — ThrottleAI's internal `now()` bypasses `Date.now()` when a test clock is active. However, `vi.useFakeTimers()` is fine for testing `setInterval`-based behavior (like the reaper).

---

## "Dispose / use-after-dispose behavior"

Calling `governor.dispose()` stops the TTL reaper interval. After dispose:

- **`acquire()` still works.** The governor doesn't "shut down" — it just stops sweeping expired leases.
- **Expired leases won't be reaped.** They'll sit until they're explicitly released or the governor is garbage-collected.
- **`dispose()` is idempotent.** Calling it twice is safe — no error, no side effect.

**When to call dispose:** On application shutdown (e.g., `process.on("SIGINT")`), or in test teardown. If you don't call it, the reaper `setInterval` keeps the Node.js process alive.

---

## "My onEvent threw — what happens now?"

Nothing bad. Since v0.1.3, the governor catches errors thrown by `onEvent` callbacks:

```ts
createGovernor({
  onEvent: (e) => {
    throw new Error("oops"); // This won't crash the governor
  },
});
```

**Behavior:** The error is silently swallowed. The acquire/release/deny operation completes normally. This prevents a logging or metrics bug from taking down your application.

**If you need to know about handler errors:** Wrap your handler in a try/catch and report to your own error tracker:

```ts
onEvent: (e) => {
  try {
    myMetrics.record(e);
  } catch (err) {
    myErrorTracker.report(err);
  }
},
```
