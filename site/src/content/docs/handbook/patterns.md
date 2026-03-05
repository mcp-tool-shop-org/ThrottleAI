---
title: Patterns
description: Common patterns for using ThrottleAI — 429 vs queue, interactive vs background, streaming, and observability.
sidebar:
  order: 2
---

## Server endpoint: 429 vs queue

When a request is denied, you have two strategies.

### Option A: immediate deny with 429

Return a 429 response immediately and let the client retry.

```ts
const result = await withLease(gov, request, fn);

if (!result.granted) {
  res.status(429).json({
    error: "throttled",
    retryAfterMs: result.decision.retryAfterMs,
  });
}
```

This is the default behavior and the simplest to reason about. The caller gets an instant answer.

### Option B: wait with bounded retries

Queue the request server-side with exponential backoff.

```ts
const result = await withLease(gov, request, fn, {
  strategy: "wait-then-deny",
  maxAttempts: 3,
  maxWaitMs: 5_000,
});
```

The `wait-then-deny` strategy retries internally with exponential backoff. If it succeeds within `maxAttempts` and `maxWaitMs`, the caller never sees a 429. If it fails, the deny is returned with the full decision object.

### When to choose which

| Scenario | Strategy |
|----------|----------|
| Public API with client retries | `deny` (immediate 429) |
| Internal service with latency budget | `wait-then-deny` with tight `maxWaitMs` |
| Batch pipeline that can wait | `wait` with generous `maxWaitMs` |
| User-facing chat endpoint | `wait-then-deny` with `maxWaitMs: 3_000` |

## Interactive vs background priority

ThrottleAI supports two priority levels: `interactive` and `background`. The `interactiveReserve` config reserves a number of concurrency slots exclusively for interactive requests.

```ts
// User-facing chat gets priority
gov.acquire({ actorId: "user", action: "chat", priority: "interactive" });

// Background embedding can wait
gov.acquire({ actorId: "pipeline", action: "embed", priority: "background" });
```

With `interactiveReserve: 2` and `maxInFlight: 5`, background tasks are blocked when only 2 slots remain. Those last 2 slots are reserved for interactive requests.

### How it works in practice

Suppose you have `maxInFlight: 5` and `interactiveReserve: 2`:

| In-flight | Available | Background can use | Interactive can use |
|-----------|-----------|-------------------|-------------------|
| 0 | 5 | 3 | 5 |
| 1 | 4 | 2 | 4 |
| 2 | 3 | 1 | 3 |
| 3 | 2 | 0 (blocked) | 2 |
| 4 | 1 | 0 (blocked) | 1 |
| 5 | 0 | 0 (blocked) | 0 (full) |

Background tasks see a deny with `reason: "concurrency"` as soon as the available slots drop to the interactive reserve level. Interactive requests can use all remaining slots.

## Streaming calls

For streaming responses (SSE, WebSocket-backed, OpenAI streaming), acquire the lease once and hold it for the entire stream duration.

```ts
const decision = gov.acquire({ actorId: "user", action: "stream" });
if (!decision.granted) return;

try {
  const stream = await openai.chat.completions.create({
    stream: true,
    model: "gpt-4",
    messages,
  });
  for await (const chunk of stream) {
    // process chunk
  }
  gov.release(decision.leaseId, { outcome: "success" });
} catch (err) {
  gov.release(decision.leaseId, { outcome: "error" });
  throw err;
}
```

The lease holds for the entire stream. This is correct behavior — the slot is occupied for as long as the model is generating tokens.

### Lease TTL for streams

Streaming calls often take longer than typical request-response calls. If your streams can run for 30+ seconds, increase `leaseTtlMs` to avoid premature expiration:

```ts
createGovernor({
  concurrency: { maxInFlight: 5 },
  leaseTtlMs: 120_000, // 2 minutes — enough for long streams
});
```

If a lease expires mid-stream, the governor fires an `expire` event and frees the slot. The stream continues but the governor no longer tracks it. This is a safety net, not normal operation — if you see frequent expirations, increase the TTL.

## Observability

ThrottleAI provides three observability mechanisms: events, snapshots, and formatters.

### Event stream

The `onEvent` callback fires on every acquire, deny, release, expiry, and warning:

```ts
const gov = createGovernor({
  ...presets.balanced(),
  onEvent: (e) => console.log(formatEvent(e)),
});
```

Example output:

```
[acquire] actor=user-1 action=chat leaseId=abc123
[deny] actor=user-1 action=chat reason=concurrency retryAfterMs=500
[release] leaseId=abc123 outcome=success latencyMs=1200
[expire] leaseId=def456 — TTL exceeded
```

### Point-in-time snapshot

`snapshot()` returns the governor's current state:

```ts
const snap = gov.snapshot();
console.log(formatSnapshot(snap));
// concurrency=3/5 rate=12/60 leases=3
```

The snapshot includes:

- `concurrency` — in-flight weight, max, effective max (after adaptive), available
- `requestRate` — current count vs limit
- `tokenRate` — current count vs limit
- `leases` — active count, last deny reason, last deny time

### Stats collector

For aggregated metrics (total grants, denies, average latency), use the built-in stats collector:

```ts
import { createStatsCollector, createGovernor } from "throttleai";

const stats = createStatsCollector();
const gov = createGovernor({
  ...presets.balanced(),
  onEvent: stats.handler,
});

// Later
const summary = stats.snapshot();
// { grants: 150, denies: 12, avgLatencyMs: 340, ... }
```

## Fairness in multi-tenant apps

When multiple actors share a governor, fairness prevents monopolization.

```ts
createGovernor({
  concurrency: { maxInFlight: 20 },
  fairness: {
    softCapRatio: 0.3,          // no actor gets >30% of slots
    starvationWindowMs: 10_000, // denied actors get priority for 10s
  },
});
```

Without fairness, one noisy tenant running 20 concurrent embedding jobs can exhaust all slots. With `softCapRatio: 0.3` and `maxInFlight: 20`, each actor soft-caps at 6 concurrent calls.

The starvation window ensures that actors who were recently denied get priority when slots free up. This prevents a fast actor from repeatedly snatching slots before slower actors can acquire them.
