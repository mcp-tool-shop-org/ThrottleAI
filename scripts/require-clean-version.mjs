#!/usr/bin/env node

/**
 * Pre-release gate — verifies the repo is ready to tag a release.
 *
 * Checks:
 *   1. Working tree is clean
 *   2. Git tag vX.Y.Z does not already exist
 *   3. CHANGELOG.md has an entry for the version with a date
 *
 * Usage:
 *   node scripts/require-clean-version.mjs
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const version = pkg.version;
const tag = `v${version}`;

let failed = false;

function check(label, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status}: ${label}`);
  if (!ok && detail) console.log(`       ${detail}`);
  if (!ok) failed = true;
}

// 1. Working tree clean
const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
check(
  "Working tree is clean",
  status === "",
  status ? `Uncommitted changes:\n${status}` : undefined,
);

// 2. Tag does not exist
const tags = execSync("git tag -l", { encoding: "utf-8" }).trim().split("\n");
check(
  `Tag ${tag} does not already exist`,
  !tags.includes(tag),
  `Tag ${tag} already exists — bump version in package.json first`,
);

// 3. CHANGELOG has entry for this version with a date
const changelog = readFileSync("CHANGELOG.md", "utf-8");
const versionPattern = new RegExp(
  `^## \\[${version.replace(/\./g, "\\.")}\\]\\s*—\\s*\\d{4}-\\d{2}-\\d{2}`,
  "m",
);
check(
  `CHANGELOG.md has dated entry for [${version}]`,
  versionPattern.test(changelog),
  `Expected: ## [${version}] — YYYY-MM-DD`,
);

console.log("");
if (failed) {
  console.error(`NOT READY to tag ${tag}. Fix the above and try again.`);
  process.exit(1);
} else {
  console.log(`Ready to tag ${tag}.`);
}
