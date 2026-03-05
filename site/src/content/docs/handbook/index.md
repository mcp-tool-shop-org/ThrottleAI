---
title: ThrottleAI Handbook
description: The complete guide to governing AI calls with ThrottleAI — concurrency, rate limits, fairness, and adapters.
sidebar:
  order: 0
---

ThrottleAI is a zero-dependency governor for concurrency, rate, and token budgets. It sits between your code and the model call, enforcing hard limits so stampedes never happen.

This handbook covers everything you need to go from first install to production deployment.

## What you will learn

- **[Getting Started](/ThrottleAI/handbook/getting-started/)** — Install, run the 60-second quickstart, and choose the right limiter for your workload.
- **[Patterns](/ThrottleAI/handbook/patterns/)** — Server 429 vs queue, interactive vs background priority, streaming calls, and observability.
- **[Configuration](/ThrottleAI/handbook/configuration/)** — Presets (quiet / balanced / aggressive), full config reference, and the tuning decision tree.
- **[API Reference](/ThrottleAI/handbook/api-reference/)** — Every function, type, and return shape in the public API.
- **[Adapters](/ThrottleAI/handbook/adapters/)** — Drop-in wrappers for fetch, OpenAI, tool calls, Express, and Hono.
- **[Reference](/ThrottleAI/handbook/reference/)** — Troubleshooting, testing, stability promise, security posture, and examples.

## Core idea

AI applications hit rate limits, blow budgets, and create stampedes. ThrottleAI prevents all three with a lease-based model: callers **acquire** a lease before making a call, then **release** it when done. No lease, no call. Leases auto-expire if you forget to release.

The governor tracks three independent dimensions:

| Dimension | What it caps |
|-----------|-------------|
| **Concurrency** | Simultaneous in-flight calls (weighted slots + interactive reserve) |
| **Rate** | Requests per minute and tokens per minute (rolling windows) |
| **Fairness** | Per-actor share of capacity (prevents monopolization) |

All three are optional and composable. Start with concurrency alone — it handles most workloads.

## Design principles

- **Zero dependencies.** Pure TypeScript. Ships as ESM + CJS. Runs in Node.js 18+ or any fetch-capable runtime.
- **Tree-shakeable.** Import only the adapters you use.
- **Lease-based, not queue-based.** Callers get an immediate yes/no decision. No hidden queues, no unbounded memory growth.
- **Observable.** `snapshot()` gives a point-in-time view. `onEvent` streams every acquire, deny, release, and expiry. `formatEvent()` and `formatSnapshot()` produce human-readable one-liners.
