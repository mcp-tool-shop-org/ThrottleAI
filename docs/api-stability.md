# API Stability

ThrottleAI follows [Semantic Versioning](https://semver.org/) starting at v1.0.0.

## Public API (stable)

Everything exported from `throttleai` and `throttleai/adapters/*` is public API. Breaking changes to these exports require a **major version bump** (v2.0.0+).

### `throttleai` (main entry point)

| Export | Kind | Description |
|--------|------|-------------|
| `createGovernor` | function | Factory — creates a `Governor` instance |
| `Governor` | class | Core governor with `acquire`, `release`, `snapshot`, `dispose` |
| `withLease` | function | Acquire → run → release with automatic cleanup |
| `waitForRetry` | function | Sleep for `retryAfterMs` from a deny decision |
| `retryAcquire` | function | Retry acquire with backoff |
| `presets` | object | `quiet()`, `balanced()`, `aggressive()` preset configs |
| `formatEvent` | function | One-line human-readable event formatter |
| `formatSnapshot` | function | Compact snapshot formatter |
| `createStatsCollector` | function | Zero-dep stats collector for `onEvent` |
| `createTestClock` | function | Deterministic clock for tests |

### Types (stable)

All exported types from `throttleai`:

- `GovernorConfig`, `ConcurrencyConfig`, `RateConfig`, `FairnessConfig`, `AdaptiveConfig`
- `AcquireRequest`, `AcquireDecision`, `ReleaseReport`
- `DenyReason`, `LeaseOutcome`, `Priority`, `TokenEstimate`
- `Constraints`, `LimitsHint`, `GovernorSnapshot`
- `GovernorEvent`, `GovernorEventType`, `GovernorEventHandler`
- `WithLeaseOptions`, `WithLeaseResult`, `WithLeaseStrategy`
- `StatsCollector`, `StatsSnapshot`
- `Clock`

### Adapters (stable)

| Entry point | Export | Description |
|-------------|--------|-------------|
| `throttleai/adapters/fetch` | `wrapFetch` | Wraps `fetch` with acquire/release |
| `throttleai/adapters/openai` | `wrapChatCompletions` | Wraps OpenAI-compatible chat completions |
| `throttleai/adapters/tools` | `wrapTool` | Wraps any async function as a governed tool |
| `throttleai/adapters/express` | `throttleMiddleware` | Express-compatible middleware |
| `throttleai/adapters/hono` | `throttle` | Hono middleware |

All adapters also export their option types (`AdapterGovernor`, `AdapterOptions`, etc.).

## Internal (not stable)

The following are **not** part of the public API and may change without notice in any release:

- Anything not exported from `throttleai` or `throttleai/adapters/*`
- Internal module structure (`src/pools/*`, `src/utils/*`, `src/leaseStore.ts`, etc.)
- The `Lease` interface (internal record shape)
- `AdaptiveController` class (internal, exposed only through config)
- `setNow` / `resetNow` from `src/utils/time.ts` (use `createTestClock` instead)
- File paths within `dist/` (chunk names, map files)
- CI workflow names and structure

## Stability guarantees

- **Config shape**: `GovernorConfig` fields will not be removed or have their types changed in v1.x. New optional fields may be added.
- **Event shape**: `GovernorEvent` fields will not be removed. New optional fields may be added. Event type strings (`acquire`, `deny`, `release`, `expire`, `warn`) are stable.
- **Deny reasons**: The four deny reasons (`concurrency`, `rate`, `budget`, `policy`) are stable. New reasons may be added in minor versions.
- **Adapter return shape**: `{ ok: true, result, latencyMs }` / `{ ok: false, decision }` is stable.
- **Presets**: Preset names are stable. Default values within presets may be tuned in minor versions.
