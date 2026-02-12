# ThrottleAI

Lightweight, token-based AI governance for TypeScript.

> **Status:** `v0.1.0-alpha` — API is unstable.

## What it does

ThrottleAI controls access to AI model calls through lease-based throttling:

- **Concurrency limiting** — cap in-flight calls with interactive reserve
- **Rate limiting** — requests-per-minute with rolling window
- **Lease lifecycle** — acquire before, release after, auto-expire on timeout

## Install

```bash
pnpm add throttleai
```

## Quick start

```ts
import { createGovernor } from "throttleai";

const gov = createGovernor({
  concurrency: { maxInFlight: 2 },
  rate: { requestsPerMinute: 30 },
  leaseTtlMs: 60_000,
});
```

Full documentation coming in v0.1.0.

## License

MIT
