# Tuning Cheatsheet

Practical heuristics for configuring ThrottleAI. Start simple, observe with `snapshot()`, then refine.

## Start here: the one-knob rule

Configure limiters in this order. Stop as soon as you have enough control.

1. **Concurrency first** — cap in-flight calls. This prevents stampedes and is the single most useful knob.
2. **Rate second** — add `requestsPerMinute` if the upstream API enforces a rate limit.
3. **Token budget third** — add `tokensPerMinute` only if you have a per-minute token budget (e.g., OpenAI tier limits).

Most apps only need concurrency.

## Common scenarios

### Protect an upstream API (e.g., OpenAI, Anthropic)

You have a hard rate limit from the provider.

```ts
createGovernor({
  concurrency: { maxInFlight: 10 },
  rate: { requestsPerMinute: 500 },        // match provider limit
  adaptive: true,                           // auto-tune if latency climbs
});
```

**Why adaptive?** Provider rate limits are documented but actual throughput varies. Adaptive reduces concurrency when latency spikes (indicating upstream pressure).

### Protect a local model (Ollama, vLLM, llama.cpp)

You're GPU-bound, not API-bound. Concurrency is the bottleneck.

```ts
createGovernor({
  concurrency: { maxInFlight: 3 },          // match GPU capacity
  rate: { tokensPerMinute: 200_000 },       // optional: cap token throughput
  leaseTtlMs: 120_000,                      // local models can be slow — extend TTL
});
```

**Skip rate limiting** unless you're paying per-token through a proxy. For local models, concurrency alone prevents OOM and context-switching overhead.

### User-facing latency SLO

Interactive users can't wait more than a few seconds.

```ts
createGovernor({
  concurrency: { maxInFlight: 8, interactiveReserve: 3 },
  adaptive: {
    targetDenyRate: 0.05,
    latencyThreshold: 1.3,                  // react early: 30% above baseline
    adjustIntervalMs: 3_000,                // faster feedback loop
  },
});

// Use withLease for bounded wait
const result = await withLease(gov, request, fn, {
  strategy: "wait-then-deny",
  maxWaitMs: 3_000,                         // hard latency ceiling
  maxAttempts: 2,
});
```

**Key insight:** `interactiveReserve` holds slots for real users even when background jobs are running. `maxWaitMs` on `withLease` gives you a hard latency guarantee.

### Multi-tenant SaaS

Multiple actors share the same governor. Fairness prevents any one user from hogging capacity.

```ts
createGovernor({
  concurrency: { maxInFlight: 20, interactiveReserve: 5 },
  rate: { requestsPerMinute: 300 },
  fairness: {
    softCapRatio: 0.3,                      // no actor gets >30% of slots
    starvationWindowMs: 10_000,             // denied actors get priority for 10s
  },
});
```

**Without fairness:** one noisy tenant can exhaust all slots. With `softCapRatio: 0.3` and `maxInFlight: 20`, each actor soft-caps at 6 concurrent calls.

### Batch pipeline (embeddings, migrations)

Throughput matters more than latency.

```ts
createGovernor({
  concurrency: { maxInFlight: 20 },
  rate: { requestsPerMinute: 500, tokensPerMinute: 500_000 },
});

// All requests are background priority
gov.acquire({ actorId: "pipeline", action: "embed", priority: "background" });
```

**Skip adaptive and fairness.** Batch jobs have predictable load — let the governor run at full capacity.

## Decision tree

```
Is your app user-facing?
├─ YES → Set interactiveReserve ≥ 1 and consider adaptive: true
└─ NO  → Skip interactiveReserve

Does the upstream have a rate limit?
├─ YES → Set requestsPerMinute to match (leave 10-20% headroom)
└─ NO  → Skip rate config

Do you have multiple actors/users?
├─ YES → Enable fairness: true (or tune softCapRatio)
└─ NO  → Skip fairness

Is latency unpredictable?
├─ YES → Enable adaptive: true
└─ NO  → Skip adaptive (manual tuning is simpler)
```

## When adaptive helps vs hurts

**Helps when:**
- Upstream latency is variable (cloud APIs, shared GPUs)
- You don't know the right concurrency up front
- Load patterns change throughout the day

**Hurts when:**
- Latency is constant (local model with fixed batch size)
- You know the exact capacity (you own the hardware)
- Traffic is bursty and low-volume (not enough samples for good EMA)

If adaptive oscillates, increase `adjustIntervalMs` (slower reactions) or lower `alpha` (smoother signal).

## Quick reference

| Knob | Default | When to change |
|------|---------|----------------|
| `maxInFlight` | — | Always set this. Match your upstream capacity. |
| `interactiveReserve` | 0 | Set to 1-3 if you have user-facing + background traffic |
| `requestsPerMinute` | — | Match your provider's rate limit |
| `tokensPerMinute` | — | Only if you have a per-minute token budget |
| `leaseTtlMs` | 60 000 | Increase for slow operations, decrease for fast APIs |
| `fairness` | off | Enable for multi-tenant / multi-actor |
| `softCapRatio` | 0.6 | Lower = stricter fairness (0.3 for many actors) |
| `adaptive` | off | Enable when latency is unpredictable |
| `targetDenyRate` | 0.05 | Higher = more aggressive (more throughput, more denials) |
| `latencyThreshold` | 1.5 | Lower = more sensitive to latency spikes |
| `adjustIntervalMs` | 5 000 | Lower = faster reaction, noisier signal |
| `strict` | false | Enable in dev for lease hygiene warnings |
