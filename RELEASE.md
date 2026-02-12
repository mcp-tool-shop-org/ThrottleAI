# Release Process

## Versioning

ThrottleAI follows [Semantic Versioning](https://semver.org/):

- **MAJOR** — breaking changes to the public API
- **MINOR** — new features, backward-compatible
- **PATCH** — bug fixes, backward-compatible

## Pre-release checklist

Run the full gate in one command:

```bash
pnpm check
```

This runs, in order:

1. **typecheck** — `tsc --noEmit`
2. **lint** — `eslint src test`
3. **test** — `vitest run` (all tests must pass)
4. **build** — `tsup` (dual CJS/ESM output)
5. **bundle-check** — core must not import adapter code
6. **size-guard** — core ESM bundle must be under 50 KB

If any step fails, the pipeline stops. Fix the issue before releasing.

## Publishing

```bash
# 1. Ensure you're on main and clean
git checkout main
git pull origin main
git status  # must be clean

# 2. Run all gates
pnpm check

# 3. Bump version in package.json
# Edit manually or use: npm version <major|minor|patch>

# 4. Commit and tag
git add package.json
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z

# 5. Push
git push origin main --tags

# 6. Publish to npm
pnpm publish --access public

# 7. Create GitHub release
gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes
```

## CI

GitHub Actions runs on every push and PR:

- Node.js matrix: 18, 20, 22
- Steps: typecheck, lint, test, build, bundle-check, size-guard

See `.github/workflows/ci.yml`.

## Size budget

| Bundle | Max size |
|--------|----------|
| Core ESM (`dist/index.js`) | 50 KB |

If the core grows past the budget, `pnpm check` will fail. Either:
- Refactor to reduce size
- Increase the budget in `scripts/size-guard.js` with justification
