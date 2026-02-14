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

## Pull requests

- Keep PRs focused (one theme per PR).
- Add/adjust tests for behavior changes.
- Run `pnpm check` locally before opening the PR.
- If you touch public API types (in `src/types.ts`), call that out explicitly in the PR description.

## Code style

- TypeScript strict mode is expected.
- Prefer small, composable utilities over new abstractions.
- Avoid adding runtime dependencies unless there's a compelling reason.

## Release process

See `RELEASE.md`.
