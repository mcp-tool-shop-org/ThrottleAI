---
title: Getting Started
description: Install ThrottleAI, run the 60-second quickstart, and choose the right limiter for your workload.
sidebar:
  order: 1
---

## Install

```bash
# npm
npm install throttleai

# pnpm
pnpm add throttleai

# yarn
yarn add throttleai
```

ThrottleAI has zero runtime dependencies. It ships as dual ESM + CJS and runs on Node.js 18+.

## 60-second quickstart

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

That is the entire flow: create a governor, wrap your call in `withLease`, and check whether it was granted. The governor enforces concurrency, rate limits, and fairness. Leases auto-expire if you forget to release them.

## Choose your limiter

ThrottleAI has five limiter dimensions. You do not need all of them — start with concurrency and add others only when you have a specific reason.

| Limiter | What it caps | When to use |
|---------|-------------|-------------|
| **Concurrency** | Simultaneous in-flight calls | Always. This is the most important knob. |
| **Rate** | Requests per minute | When the upstream API has a documented rate limit. |
| **Token rate** | Tokens per minute | When you have a per-minute token budget. |
| **Fairness** | Per-actor share of capacity | Multi-tenant apps where one user should not monopolize slots. |
| **Adaptive** | Auto-tuned concurrency ceiling | When upstream latency is unpredictable. |

### The one-knob rule

Configure limiters in this order and stop as soon as you have enough control:

1. **Concurrency first** — cap in-flight calls. This prevents stampedes and is the single most useful setting.
2. **Rate second** — add `requestsPerMinute` if the upstream API enforces a rate limit.
3. **Token budget third** — add `tokensPerMinute` only if you have a per-minute token budget (for example, OpenAI tier limits).

Most applications only need concurrency.

## Minimal examples by scenario

### Protect an upstream API (OpenAI, Anthropic)

You have a hard rate limit from the provider.

```ts
createGovernor({
  concurrency: { maxInFlight: 10 },
  rate: { requestsPerMinute: 500 },
  adaptive: true,
});
```

Adaptive mode auto-tunes concurrency when latency spikes, which indicates upstream pressure.

### Protect a local model (Ollama, vLLM, llama.cpp)

You are GPU-bound, not API-bound. Concurrency is the bottleneck.

```ts
createGovernor({
  concurrency: { maxInFlight: 3 },
  leaseTtlMs: 120_000, // local models can be slow — extend TTL
});
```

Skip rate limiting unless you are paying per-token through a proxy. For local models, concurrency alone prevents OOM and context-switching overhead.

### User-facing latency SLO

Interactive users cannot wait more than a few seconds.

```ts
createGovernor({
  concurrency: { maxInFlight: 8, interactiveReserve: 3 },
  adaptive: {
    targetDenyRate: 0.05,
    latencyThreshold: 1.3,
    adjustIntervalMs: 3_000,
  },
});
```

`interactiveReserve` holds slots for real users even when background jobs are running.

### Multi-tenant SaaS

Multiple actors share the same governor. Fairness prevents any one user from monopolizing capacity.

```ts
createGovernor({
  concurrency: { maxInFlight: 20, interactiveReserve: 5 },
  rate: { requestsPerMinute: 300 },
  fairness: { softCapRatio: 0.3, starvationWindowMs: 10_000 },
});
```

With `softCapRatio: 0.3` and `maxInFlight: 20`, each actor soft-caps at 6 concurrent calls.

### Batch pipeline (embeddings, migrations)

Throughput matters more than latency.

```ts
createGovernor({
  concurrency: { maxInFlight: 20 },
  rate: { requestsPerMinute: 500, tokensPerMinute: 500_000 },
});

gov.acquire({ actorId: "pipeline", action: "embed", priority: "background" });
```

Skip adaptive and fairness. Batch jobs have predictable load — let the governor run at full capacity.
