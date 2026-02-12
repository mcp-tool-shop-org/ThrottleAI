# ThrottleAI

[![npm](https://img.shields.io/npm/v/throttleai)](https://www.npmjs.com/package/throttleai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Lightweight, token-based AI governance for TypeScript. Control access to model calls through lease-based throttling with concurrency limits, rate limiting, and interactive priority reserve.

## Why

AI applications hit rate limits, blow budgets, and create stampedes. ThrottleAI sits between your code and the model call, enforcing:

- **Concurrency** — cap in-flight calls with interactive reserve
- **Rate** — requests-per-minute with rolling window
- **Leases** — acquire before, release after, auto-expire on timeout

No external dependencies. Works in Node.js 18+.

## Install

```bash
pnpm add throttleai
# or
npm install throttleai
```

## Quick start

```ts
import { createGovernor, withLease } from "throttleai";

const gov = createGovernor({
  concurrency: { maxInFlight: 2, interactiveReserve: 1 },
  rate: { requestsPerMinute: 30 },
  leaseTtlMs: 60_000,
});

// Option 1: withLease (recommended — auto-releases)
const result = await withLease(
  gov,
  { actorId: "user-1", action: "chat.completion", priority: "interactive" },
  async () => {
    return await callMyModel();
  },
);

if (result.granted) {
  console.log(result.result);
} else {
  console.log("Denied:", result.decision.reason);
}

// Option 2: manual acquire/release
const decision = gov.acquire({
  actorId: "user-1",
  action: "chat.completion",
});

if (decision.granted) {
  try {
    const response = await callMyModel();
    gov.release(decision.leaseId, { outcome: "success" });
  } catch (e) {
    gov.release(decision.leaseId, { outcome: "error" });
    throw e;
  }
} else {
  // Backpressure: wait decision.retryAfterMs, degrade, or queue
}
```

## Configuration

```ts
createGovernor({
  // Concurrency pool (optional)
  concurrency: {
    maxInFlight: 5,          // max simultaneous leases
    interactiveReserve: 1,   // slots reserved for "interactive" priority
  },

  // Rate pool (optional)
  rate: {
    requestsPerMinute: 60,   // max requests in rolling window
    windowMs: 60_000,        // window size (default 60s)
  },

  // Lease settings
  leaseTtlMs: 60_000,        // auto-expire after 60s (default)
  reaperIntervalMs: 5_000,   // sweep interval (default 5s)
});
```

## API

### `createGovernor(config): Governor`

Factory function. Returns a `Governor` instance.

### `governor.acquire(request): AcquireDecision`

Request a lease. Returns either:

```ts
// Granted
{ granted: true, leaseId: string, expiresAt: number, constraints?: Constraints }

// Denied
{ granted: false, reason: DenyReason, retryAfterMs: number, recommendation: string }
```

Deny reasons: `"concurrency"` | `"rate"` | `"budget"` | `"policy"`

### `governor.release(leaseId, report?): void`

Release a lease. Always call this — even on errors.

### `withLease(governor, request, fn, options?): Promise<WithLeaseResult<T>>`

Execute `fn` under a lease with automatic release.

Options:
- `wait`: retry on denial with exponential backoff (default `false`)
- `maxWaitMs`: max total wait time (default `10_000`)
- `initialBackoffMs`: starting backoff (default `250`)

### Status getters

```ts
gov.activeLeases       // number of active leases
gov.concurrencyActive  // in-flight count
gov.concurrencyAvailable // remaining slots
gov.rateCount          // requests in current window
gov.rateLimit          // configured limit
```

### `governor.dispose(): void`

Stop the TTL reaper. Call when shutting down.

## Priority & interactive reserve

```ts
const gov = createGovernor({
  concurrency: { maxInFlight: 5, interactiveReserve: 2 },
});

// "interactive" callers can use all 5 slots (including the reserve)
gov.acquire({ actorId: "ui", action: "chat", priority: "interactive" });

// "background" callers can only use 3 slots (5 - 2 reserve)
gov.acquire({ actorId: "batch", action: "embed", priority: "background" });
```

## Idempotency

Pass `idempotencyKey` to get stable decisions:

```ts
const d1 = gov.acquire({ actorId: "a", action: "chat", idempotencyKey: "req-123" });
const d2 = gov.acquire({ actorId: "a", action: "chat", idempotencyKey: "req-123" });
// d1.leaseId === d2.leaseId (same lease, only 1 slot consumed)
```

## Examples

See [`examples/`](examples/) for runnable demos:

- **[node-basic.ts](examples/node-basic.ts)** — 5 concurrent calls with maxInFlight=2
- **[express-middleware.ts](examples/express-middleware.ts)** — HTTP 429 throttling middleware

```bash
npx tsx examples/node-basic.ts
```

## License

MIT
