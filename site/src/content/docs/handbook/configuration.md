---
title: Configuration
description: Presets, full configuration reference, adaptive tuning, and the decision tree for choosing what to enable.
sidebar:
  order: 3
---

## Presets

ThrottleAI ships three presets that cover the most common scenarios. Each preset returns a config object that you can spread and override.

### quiet

Single user, CLI tools — 1 call at a time, 10 requests per minute.

```ts
import { createGovernor, presets } from "throttleai";

createGovernor(presets.quiet());
```

### balanced

SaaS backend — 5 concurrent (2 interactive reserve), 60 requests per minute, fairness enabled.

```ts
createGovernor(presets.balanced());
```

### aggressive

Batch processing — 20 concurrent, 300 requests per minute, fairness + adaptive tuning.

```ts
createGovernor(presets.aggressive());
```

### Override any field

Presets are plain objects. Spread and override:

```ts
createGovernor({
  ...presets.balanced(),
  leaseTtlMs: 30_000,
  concurrency: { maxInFlight: 10, interactiveReserve: 3 },
});
```

## Full configuration reference

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

  // Fairness (optional)
  fairness: true,             // enable with defaults
  // or:
  fairness: {
    softCapRatio: 0.6,          // max share of capacity per actor (default 0.6)
    starvationWindowMs: 10_000, // denied actors get priority (default 10s)
  },

  // Adaptive tuning (optional)
  adaptive: true,             // enable with defaults
  // or:
  adaptive: {
    targetDenyRate: 0.05,     // target deny ratio (default 0.05)
    latencyThreshold: 1.5,    // EMA ratio that triggers reduction (default 1.5)
    alpha: 0.2,               // EMA smoothing factor (default 0.2)
    adjustIntervalMs: 5_000,  // how often to re-evaluate (default 5s)
  },

  // Strict mode (optional)
  strict: true,               // throw on double release / unknown ID (dev mode)

  // Lease settings
  leaseTtlMs: 60_000,         // auto-expire (default 60s)
  reaperIntervalMs: 5_000,    // sweep interval (default 5s)

  // Observability
  onEvent: (e) => { /* acquire, deny, release, expire, warn */ },
});
```

## Configuration options in detail

### Concurrency

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxInFlight` | `number` | required | Maximum simultaneous in-flight weight. This is the most important setting. |
| `interactiveReserve` | `number` | `0` | Slots reserved exclusively for `priority: "interactive"` requests. Background requests are denied when available slots drop to this level. |

### Rate

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `requestsPerMinute` | `number` | - | Maximum requests per rolling window. |
| `tokensPerMinute` | `number` | - | Maximum tokens per rolling window. |
| `windowMs` | `number` | `60_000` | Rolling window duration in milliseconds. |

### Fairness

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `softCapRatio` | `number` | `0.6` | Maximum share of `maxInFlight` any single actor can hold. With `maxInFlight: 20` and `softCapRatio: 0.3`, each actor caps at 6 slots. |
| `starvationWindowMs` | `number` | `10_000` | Actors denied within this window get priority when slots free up. |

### Adaptive

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `targetDenyRate` | `number` | `0.05` | Target deny ratio. Higher values allow more throughput but more denials. |
| `latencyThreshold` | `number` | `1.5` | EMA ratio that triggers concurrency reduction. Lower values react faster to latency spikes. |
| `alpha` | `number` | `0.2` | EMA smoothing factor. Lower values produce smoother, slower-reacting signals. |
| `adjustIntervalMs` | `number` | `5_000` | How often the adaptive controller re-evaluates. |

### Lease settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `leaseTtlMs` | `number` | `60_000` | Leases auto-expire after this duration. Set to just above your expected p99 latency. |
| `reaperIntervalMs` | `number` | `5_000` | How often the reaper sweeps for expired leases. |

## Decision tree

Use this to decide which limiters to enable:

```
Is your app user-facing?
+-- YES --> Set interactiveReserve >= 1, consider adaptive: true
+-- NO  --> Skip interactiveReserve

Does the upstream have a rate limit?
+-- YES --> Set requestsPerMinute to match (leave 10-20% headroom)
+-- NO  --> Skip rate config

Do you have multiple actors/users?
+-- YES --> Enable fairness: true (or tune softCapRatio)
+-- NO  --> Skip fairness

Is latency unpredictable?
+-- YES --> Enable adaptive: true
+-- NO  --> Skip adaptive (manual tuning is simpler)
```

## When adaptive helps vs hurts

**Adaptive helps when:**
- Upstream latency is variable (cloud APIs, shared GPUs)
- You do not know the right concurrency up front
- Load patterns change throughout the day

**Adaptive hurts when:**
- Latency is constant (local model with fixed batch size)
- You know the exact capacity (you own the hardware)
- Traffic is bursty and low-volume (not enough samples for a good EMA)

If adaptive oscillates, increase `adjustIntervalMs` (slower reactions) or lower `alpha` (smoother signal).

## Tuning quick reference

| You see this | Adjust this |
|---|---|
| `reason: "concurrency"` | Increase `maxInFlight` or decrease call duration |
| `reason: "rate"` | Increase `requestsPerMinute` / `tokensPerMinute` |
| `reason: "policy"` (fairness) | Lower `softCapRatio` or increase `maxInFlight` |
| High `retryAfterMs` | Reduce `leaseTtlMs` so expired leases free faster |
| Background tasks starved | Increase `maxInFlight` or reduce `interactiveReserve` |
| Interactive latency high | Increase `interactiveReserve` |
| Adaptive shrinks too fast | Lower `alpha` or raise `targetDenyRate` |
