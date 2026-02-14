# Repo Hygiene

## Large files in git history

| File | Size | In HEAD? | Notes |
|------|------|----------|-------|
| `logo.png` | 2.1 MB | Yes | High-res PNG; README uses `logo.jpg` (62 KB) instead |
| `logo.jpg` | 62 KB | Yes | Used by README — keep |

**Total bloat: ~2.1 MB** — all from `logo.png`.

The `throttleai_press_kit.zip` (4.3 MB) was never committed and should stay that way.

## Where assets should live

- **Logo (JPEG, ≤100 KB):** In-repo at `logo.jpg` — needed for npm/GitHub rendering.
- **High-res assets, press kits, design sources:** Attach to a [GitHub Release](https://github.com/mcp-tool-shop-org/ThrottleAI/releases) as binary assets. Do not commit to the repo.

## Cleanup plan

1. Remove `logo.png` from HEAD (it's unused — README points to `logo.jpg`).
2. Run `git filter-repo` to purge `logo.png` from all history.
3. Force-push the rewritten history to `main`.
4. Upload `logo.png` and press kit to a GitHub Release for archival.

**After force-push, all contributors must re-clone:**

```bash
# Delete your old clone, then:
git clone https://github.com/mcp-tool-shop-org/ThrottleAI.git
```

## Guardrails

- `.gitignore` blocks `*.zip` and `design_src/` to prevent future big-file commits.
- CI runs a file-size check that fails PRs adding any file > 1 MB.
