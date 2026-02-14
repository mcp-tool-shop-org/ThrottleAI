#!/usr/bin/env node

/**
 * File-size guard — fails if any staged file exceeds the threshold.
 *
 * Intended for CI on pull requests. Prevents large binaries from
 * creeping into the repo.
 *
 * Usage:
 *   node scripts/file-size-guard.mjs                  # default 1 MB limit
 *   node scripts/file-size-guard.mjs --max-kb=512     # custom limit
 *
 * In CI, compare against the base branch:
 *   git diff --name-only --diff-filter=A origin/main...HEAD | \
 *     xargs node scripts/file-size-guard.mjs --files
 */

import { statSync } from "node:fs";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);

// Parse --max-kb flag (default: 1024 KB = 1 MB)
const maxKbArg = args.find((a) => a.startsWith("--max-kb="));
const MAX_KB = maxKbArg ? Number(maxKbArg.split("=")[1]) : 1024;

// Allowlist — files that are permitted to exceed the limit
const ALLOWLIST = new Set([
  // Add exceptions here if needed, e.g.:
  // "some-large-but-necessary-file.wasm",
]);

// Get files to check: either from --files mode (stdin-like args) or from git diff
let files;
const filesIdx = args.indexOf("--files");
if (filesIdx !== -1) {
  files = args.slice(filesIdx + 1);
} else {
  // Default: check all files added in the current branch vs origin/main
  try {
    const diff = execSync("git diff --name-only --diff-filter=A origin/main...HEAD", {
      encoding: "utf-8",
    }).trim();
    files = diff ? diff.split("\n") : [];
  } catch {
    // Fallback: no base branch available (e.g., initial commit)
    files = [];
  }
}

let failed = false;

for (const file of files) {
  if (ALLOWLIST.has(file)) continue;

  try {
    const stat = statSync(file);
    const kb = stat.size / 1024;
    if (kb > MAX_KB) {
      console.error(`FAIL: ${file} — ${kb.toFixed(1)} KB (max: ${MAX_KB} KB)`);
      failed = true;
    }
  } catch {
    // File doesn't exist on disk (deleted in a later commit) — skip
  }
}

if (failed) {
  console.error(
    `\nOne or more added files exceed ${MAX_KB} KB. ` +
      "Large binaries should go in GitHub Releases, not the repo. " +
      "See docs/repo-hygiene.md for details."
  );
  process.exit(1);
} else {
  if (files.length > 0) {
    console.log(`PASS: ${files.length} new file(s) checked, all under ${MAX_KB} KB`);
  } else {
    console.log("PASS: No new files to check");
  }
}
