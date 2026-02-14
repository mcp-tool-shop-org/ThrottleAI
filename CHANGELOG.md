# Changelog

All notable changes to **ThrottleAI** will be documented in this file.

The format is based on *Keep a Changelog*, and the project adheres to *Semantic Versioning* once it reaches v1.0.0.

## [Unreleased]

## [0.1.3] — 2026-02-14

### Fixed
- Governor `_emit` now catches errors thrown by user-supplied `onEvent` callbacks, preventing a logging crash from taking down the governor.

### Changed
- Upgraded Vitest from 2.x to 4.0.18 (dev tooling only — no public API changes).

### Added
- Compat harness CI workflow (`test-compat.yml`) for safe major-dependency upgrades.
- `scripts/print-vitest-env.mjs` diagnostic helper for CI debugging.
- Vitest upgrade protocol documented in `CONTRIBUTING.md`.
- Safety-net tests: reaper TTL expiry, `onEvent` error isolation, post-dispose behavior, concurrent mutation (11 new tests, 240 total).

### Security
- Bumped transitive `esbuild` to >=0.25.0 via pnpm override to address GHSA-67mh-4wv8-2f99 (dev-only).

### Added (repo hygiene)
- `scripts/security-audit.mjs` — run `pnpm audit:prod` / `pnpm audit` locally.
- Weekly security audit CI workflow (`security-audit.yml`) on schedule + `workflow_dispatch`.
- Dependabot groups dev-tool updates into a single weekly PR.
- `packageManager` field pins pnpm version for reproducible installs.
- `scripts/file-size-guard.mjs` — blocks PRs adding files > 1 MB.
- `docs/repo-hygiene.md` — asset policy and history rewrite log.

### Removed
- `logo.png` (2.1 MB) purged from HEAD and all git history via `git filter-repo`.

## [0.1.2] — 2026-02-12

### Changed
- Internal improvements and bug fixes.

## [0.1.1] — 2026-02-12

### Changed
- Use absolute GitHub URL for logo on npm.

## [0.1.0] — 2026-02-12

### Added
- Initial public release.
- Token-based lease governor with concurrency, rate, and token-rate pools.
- Fairness tracking with per-actor soft cap and anti-starvation.
- Adaptive concurrency controller (EMA-based).
- Presets: quiet, balanced, aggressive.
- Tree-shakeable adapters: fetch, OpenAI, tools, Express, Hono.
- `withLease` helper with deny / wait / wait-then-deny strategies.
- `formatEvent` and `formatSnapshot` observability utilities.
- `createTestClock` for deterministic testing.
- Strict mode for development safety rails.
- Idempotency key support.
