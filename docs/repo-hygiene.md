# Repo Hygiene

## History rewrite — 2026-02-14

`logo.png` (2.1 MB) was purged from all git history via `git filter-repo`.
The pre-rewrite state is preserved at tag `pre-filter-repo-20260214`.

**If you had an existing clone, you must re-clone:**

```bash
# Delete your old clone, then:
git clone https://github.com/mcp-tool-shop-org/ThrottleAI.git
```

If you have local branches with unpushed work, contact a maintainer for help transplanting them.

## Where assets should live

- **Logo (JPEG, ≤100 KB):** In-repo at `logo.jpg` — needed for npm/GitHub rendering.
- **High-res assets, press kits, design sources:** Attach to a [GitHub Release](https://github.com/mcp-tool-shop-org/ThrottleAI/releases) as binary assets. Do not commit to the repo.

## Guardrails

- `.gitignore` blocks `*.zip` and `design_src/` to prevent future big-file commits.
- CI runs a file-size check that fails PRs adding any file > 1 MB.
