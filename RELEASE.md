# Release Process

## Versioning

ThrottleAI follows [Semantic Versioning](https://semver.org/):

- **MAJOR** — breaking changes to the public API
- **MINOR** — new features, backward-compatible
- **PATCH** — bug fixes, backward-compatible

Version source of truth: `package.json` → `version` field.
Tag format: `vX.Y.Z`.

## Pre-release checklist

```bash
# 1. Run all gates
pnpm check

# 2. Bump version in package.json

# 3. Move [Unreleased] changelog entries under [X.Y.Z] — YYYY-MM-DD

# 4. Commit
git add package.json CHANGELOG.md
git commit -m "release: vX.Y.Z"

# 5. Verify release readiness
node scripts/require-clean-version.mjs

# 6. Tag and push
git tag vX.Y.Z
git push origin main --tags
```

CI handles the rest: `release.yml` builds, tests, creates the GitHub Release with artifacts, and publishes to npm.

## Dry-run (release candidate)

Use the **Release Candidate** workflow (`workflow_dispatch`) to validate the full build + pack pipeline without publishing. See `.github/workflows/release-candidate.yml`.

## `pnpm check` pipeline

Runs in order:

1. **typecheck** — `tsc --noEmit`
2. **lint** — `eslint src test`
3. **test** — `vitest run` (all tests must pass)
4. **build** — `tsup` (dual CJS/ESM output)
5. **bundle-check** — core must not import adapter code
6. **size-guard** — core ESM bundle must be under 50 KB

If any step fails, the pipeline stops. Fix the issue before releasing.

## Size budget

| Bundle | Max size |
|--------|----------|
| Core ESM (`dist/index.js`) | 50 KB |

If the core grows past the budget, `pnpm check` will fail. Either:
- Refactor to reduce size
- Increase the budget in `scripts/size-guard.js` with justification

## Full details

See `docs/release-manifest.md` for artifact requirements and version conventions.
