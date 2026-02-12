<p align="center">
  <img src="logo.png" alt="ThrottleAI" width="400">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/throttleai"><img src="https://img.shields.io/npm/v/throttleai" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <em>A token-based lease governor for AI calls — small enough to embed anywhere, strict enough to prevent stampedes.</em>
</p>

---

## 60-second quickstart

```bash
pnpm add throttleai
```

```ts
import { createGovernor, withLease, presets } from "throttleai";

const gov = createGovernor(presets.balanced());

const result = await withLease(
  gov,
  { actorId: "user-1", action: "chat" },
  async () => await callMyModel(),
);

if (result.granted) {
  console.log(result.result);
} else {
  console.log("Throttled:", result.decision.recommendation);
}
```

That's it. The governor enforces concurrency, rate limits, and fairness. Leases auto-expire if you forget to release.

## Why

AI applications hit rate limits, blow budgets, and create stampedes. ThrottleAI sits between your code and the model call, enforcing:

- **Concurrency** — cap in-flight calls with weighted slots and interactive reserve
- **Rate** — requests/min and tokens/min with rolling windows
- **Fairness** — no single actor monopolizes capacity
- **Leases** — acquire before, release after, auto-expire on timeout
- **Observability** — `snapshot()`, `onEvent`, and `formatEvent()` for debugging

Zero dependencies. Node.js 18+. Tree-shakeable.

## Presets

```ts
import { presets } from "throttleai";

// Single user, CLI tools — 1 call at a time, 10 req/min
createGovernor(presets.quiet());

// SaaS backend — 5 concurrent (2 interactive reserve), 60 req/min, fairness
createGovernor(presets.balanced());

// Batch processing — 20 concurrent, 300 req/min, fairness + adaptive tuning
createGovernor(presets.aggressive());

// Override any field
createGovernor({ ...presets.balanced(), leaseTtlMs: 30_000 });
```

## Common patterns

### Server endpoint: 429 vs queue

```ts
// Option A: immediate deny with 429
const result = await withLease(gov, request, fn);
// result.granted === false → respond with 429

// Option B: wait with bounded retries
const result = await withLease(gov, request, fn, {
  strategy: "wait-then-deny",
  maxAttempts: 3,
  maxWaitMs: 5_000,
});
```

### UI interactive vs background

```ts
// User-facing chat gets priority
gov.acquire({ actorId: "user", action: "chat", priority: "interactive" });

// Background embedding can wait
gov.acquire({ actorId: "pipeline", action: "embed", priority: "background" });
```

With `interactiveReserve: 2`, background tasks are blocked when only 2 slots remain, keeping those for interactive requests.

### Streaming calls

```ts
const decision = gov.acquire({ actorId: "user", action: "stream" });
if (!decision.granted) return;

try {
  const stream = await openai.chat.completions.create({ stream: true, ... });
  for await (const chunk of stream) {
    // process chunk
  }
  gov.release(decision.leaseId, { outcome: "success" });
} catch (err) {
  gov.release(decision.leaseId, { outcome: "error" });
  throw err;
}
```

Acquire once, release once — the lease holds for the entire stream duration.

### Observability: see why it throttles

```ts
import { createGovernor, formatEvent, formatSnapshot } from "throttleai";

const gov = createGovernor({
  ...presets.balanced(),
  onEvent: (e) => console.log(formatEvent(e)),
  // [deny] actor=user-1 action=chat reason=concurrency retryAfterMs=500 — All 5 slots in use...
});

// Point-in-time view
console.log(formatSnapshot(gov.snapshot()));
// concurrency=3/5 rate=12/60 leases=3
```

## Configuration

```ts
createGovernor({
  // Concurrency (optional)
  concurrency: {
    maxInFlight: 5,          // max simultaneous weight
    interactiveReserve: 1,   // slots reserved for interactive priority
  },

  // Rate limiting (optional)
  rate: {
    requestsPerMinute: 60,   // request-rate cap
    tokensPerMinute: 100_000, // token-rate cap
    windowMs: 60_000,         // rolling window (default 60s)
  },

  // Advanced (optional)
  fairness: true,             // prevent actor monopolization
  adaptive: true,             // auto-tune concurrency from deny rate + latency
  strict: true,               // throw on double release / unknown ID (dev mode)

  // Lease settings
  leaseTtlMs: 60_000,         // auto-expire (default 60s)
  reaperIntervalMs: 5_000,    // sweep interval (default 5s)

  // Observability
  onEvent: (e) => { /* acquire, deny, release, expire, warn */ },
});
```

## API

### `createGovernor(config): Governor`

Factory function. Returns a `Governor` instance.

### `governor.acquire(request): AcquireDecision`

Request a lease. Returns:

```ts
// Granted
{ granted: true, leaseId: string, expiresAt: number }

// Denied
{ granted: false, reason, retryAfterMs, recommendation, limitsHint? }
```

Deny reasons: `"concurrency"` | `"rate"` | `"budget"` | `"policy"`

### `governor.release(leaseId, report?): void`

Release a lease. Always call this — even on errors.

### `withLease(governor, request, fn, options?)`

Execute `fn` under a lease with automatic release.

```ts
withLease(gov, request, fn, {
  strategy: "deny",           // default — fail immediately
  strategy: "wait",           // retry with backoff until maxWaitMs
  strategy: "wait-then-deny", // retry up to maxAttempts
  maxWaitMs: 10_000,          // max total wait (default 10s)
  maxAttempts: 3,             // for "wait-then-deny" (default 3)
  initialBackoffMs: 250,      // starting backoff (default 250ms)
});
```

### `governor.snapshot(): GovernorSnapshot`

Point-in-time state: concurrency, rate, tokens, last deny.

### `formatEvent(event): string` / `formatSnapshot(snap): string`

One-line human-readable formatters.

### Status getters

```ts
gov.activeLeases         // active lease count
gov.concurrencyActive    // in-flight weight
gov.concurrencyAvailable // remaining capacity
gov.rateCount            // requests in current window
gov.tokenRateCount       // tokens in current window
```

### `governor.dispose(): void`

Stop the TTL reaper. Call on shutdown.

## Adapters

Tree-shakeable wrappers — import only what you use. No runtime deps.

### fetch

```ts
import { wrapFetch } from "throttleai/adapters/fetch";
const throttledFetch = wrapFetch(fetch, { governor: gov });
const r = await throttledFetch("https://api.example.com/v1/chat");
if (r.ok) console.log(r.response.status);
```

### OpenAI-compatible

```ts
import { wrapChatCompletions } from "throttleai/adapters/openai";
const chat = wrapChatCompletions(openai.chat.completions.create, { governor: gov });
const r = await chat({ model: "gpt-4", messages });
if (r.ok) console.log(r.result.choices[0].message.content);
```

### Tool call

```ts
import { wrapTool } from "throttleai/adapters/tools";
const embed = wrapTool(myEmbedFn, { governor: gov, toolId: "embed", costWeight: 2 });
const r = await embed("hello");
if (r.ok) console.log(r.result);
```

### Express

```ts
import { throttleMiddleware } from "throttleai/adapters/express";
app.use("/ai", throttleMiddleware({ governor: gov }));
// 429 + Retry-After header + JSON body on deny
```

### Hono

```ts
import { throttle } from "throttleai/adapters/hono";
app.use("/ai/*", throttle({ governor: gov }));
// 429 JSON on deny, leaseId stored on context
```

All adapters return `{ ok: true, result, latencyMs }` on grant, `{ ok: false, decision }` on deny.

## Tuning guide

| You see this | Adjust this |
|---|---|
| `reason: "concurrency"` | Increase `maxInFlight` or decrease call duration |
| `reason: "rate"` | Increase `requestsPerMinute` / `tokensPerMinute` |
| `reason: "policy"` (fairness) | Lower `softCapRatio` or increase `maxInFlight` |
| High `retryAfterMs` | Reduce `leaseTtlMs` so expired leases free faster |
| Background tasks starved | Increase `maxInFlight` or reduce `interactiveReserve` |
| Interactive latency high | Increase `interactiveReserve` |
| Adaptive shrinks too fast | Lower `alpha` or raise `targetDenyRate` |

Use `snapshot()` and `formatSnapshot()` to observe state in production.

## Examples

See [`examples/`](examples/) for runnable demos:

- **[node-basic.ts](examples/node-basic.ts)** — burst simulation with snapshot printing
- **[express-middleware.ts](examples/express-middleware.ts)** — 429 + retry-after endpoint
- **[cookbook-adapters.ts](examples/cookbook-adapters.ts)** — all five adapters in action
- **[cookbook-burst-snapshot.ts](examples/cookbook-burst-snapshot.ts)** — burst load with governor snapshots
- **[cookbook-interactive-reserve.ts](examples/cookbook-interactive-reserve.ts)** — interactive vs background priority

```bash
npx tsx examples/node-basic.ts
```

## License

MIT
