# Contributing

Thanks for helping improve ThrottleAI.

## Development setup

- Node.js: >= 18
- Package manager: pnpm

Install deps:

```bash
pnpm install
```

## Common commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check   # runs all gates
```

## Testing

Tests live in `test/` and use [vitest](https://vitest.dev/).

```bash
pnpm test            # run all tests once
pnpm test:watch      # re-run on file changes
```

**Conventions:**

- Every test file explicitly imports `{ describe, it, expect }` from `vitest` (do not rely on globals).
- Use `createTestClock()` / `setNow()` / `resetNow()` from `src/utils/time.ts` for deterministic timing — never `setTimeout` or real clocks.
- Call `governor.dispose()` and `resetNow()` in `afterEach` to prevent state leaks.
- Only `vi.fn()` is used for mocking (one file). Avoid `vi.mock()` and module-level mocks — keep tests self-contained.

**Node matrix:** CI runs on Node 18, 20, and 22.

## Changelog

If your change is user-facing (new feature, bug fix, breaking change, deprecation), add an entry to `CHANGELOG.md` under `## [Unreleased]` using the appropriate subsection:

- **Added** — new features
- **Changed** — changes to existing behavior
- **Deprecated** — features marked for removal
- **Removed** — features that were removed
- **Fixed** — bug fixes
- **Security** — vulnerability fixes

Internal changes (refactors, CI tweaks, docs) do not need a changelog entry.

## Pull requests

- Keep PRs focused (one theme per PR).
- Add/adjust tests for behavior changes.
- Update `CHANGELOG.md` for user-facing changes (see above).
- Run `pnpm check` locally before opening the PR.
- If you touch public API types (in `src/types.ts`), call that out explicitly in the PR description.

## Code style

- TypeScript strict mode is expected.
- Prefer small, composable utilities over new abstractions.
- Avoid adding runtime dependencies unless there's a compelling reason.

## Release process

See `RELEASE.md`.
