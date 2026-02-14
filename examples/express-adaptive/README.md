# Express Adaptive Example

A runnable Express server showing ThrottleAI's adaptive concurrency in action.

## Quick start

```bash
# From the repo root
pnpm add express @types/express   # one-time
npx tsx examples/express-adaptive/server.ts
```

In another terminal:

```bash
npx tsx examples/express-adaptive/load.ts
# or manually:
curl http://localhost:3000/fast
curl http://localhost:3000/slow
curl http://localhost:3000/stats
```

## What you'll see

| Route | Behavior |
|-------|----------|
| `GET /fast` | Returns instantly — always granted |
| `GET /slow` | 200–800 ms latency + 20% simulated errors |
| `GET /stats` | Governor snapshot + grant/deny counts |

The server prints stats every 5 seconds:

```
[stats] concurrency=2/4 rate=8/120 leases=2 | grants=12 denials=3 denyRate=20.0% effectiveMax=3
```

Watch `effectiveMax` drop under heavy `/slow` load (adaptive reducing concurrency) and recover when load subsides.

## What to tweak

| Knob | Effect |
|------|--------|
| `maxInFlight` | Total concurrent slots (currently 4) |
| `interactiveReserve` | Slots held back for priority requests (currently 1) |
| `adjustIntervalMs` | How fast adaptive reacts (currently 3s — lower = faster) |
| `targetDenyRate` | Acceptable denial percentage (currently 10%) |
| `latencyThreshold` | How much latency increase triggers scale-down (currently 1.5×) |

## Architecture

```
Request → throttleMiddleware → governor.acquire()
                                  ├─ granted → route handler → res.finish → governor.release(outcome, latencyMs)
                                  └─ denied  → 429 + Retry-After header
                                                   ↓
                              AdaptiveController watches latency + deny rate
                              and adjusts effectiveMax every adjustIntervalMs
```

The middleware handles the full lifecycle: acquire on request, release on response finish (with outcome and latency automatically reported).
