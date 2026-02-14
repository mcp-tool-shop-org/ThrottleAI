#!/usr/bin/env node

/**
 * Changelog lint — verifies CHANGELOG.md has a valid entry for the
 * current package.json version.
 *
 * Checks:
 *   1. Version entry exists: ## [X.Y.Z]
 *   2. Date is present and valid: — YYYY-MM-DD
 *   3. At least one section header exists under the entry (Added/Changed/Fixed/etc.)
 *
 * Usage:
 *   node scripts/changelog-check.mjs            # check current version
 *   node scripts/changelog-check.mjs --strict    # also fail if [Unreleased] is empty
 */

import { readFileSync } from "node:fs";

const strict = process.argv.includes("--strict");

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const version = pkg.version;
const changelog = readFileSync("CHANGELOG.md", "utf-8");

let failed = false;

function check(label, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status}: ${label}`);
  if (!ok && detail) console.log(`       ${detail}`);
  if (!ok) failed = true;
}

// 1. Version entry exists
const versionHeader = new RegExp(
  `^## \\[${version.replace(/\./g, "\\.")}\\]`,
  "m",
);
check(
  `CHANGELOG has entry for [${version}]`,
  versionHeader.test(changelog),
  `Missing: ## [${version}] — YYYY-MM-DD`,
);

// 2. Date is present and valid
const versionWithDate = new RegExp(
  `^## \\[${version.replace(/\./g, "\\.")}\\]\\s*—\\s*(\\d{4}-\\d{2}-\\d{2})`,
  "m",
);
const dateMatch = changelog.match(versionWithDate);
check(
  `Entry has a date (YYYY-MM-DD)`,
  dateMatch !== null,
  `Expected: ## [${version}] — YYYY-MM-DD`,
);

if (dateMatch) {
  const d = new Date(dateMatch[1]);
  check(
    `Date ${dateMatch[1]} is valid`,
    !isNaN(d.getTime()),
    "Date does not parse as a valid calendar date",
  );
}

// 3. At least one section header under the version entry
const versionIdx = changelog.search(versionHeader);
if (versionIdx !== -1) {
  // Extract text between this version header and the next ## header (or EOF)
  const rest = changelog.slice(versionIdx);
  const nextHeader = rest.indexOf("\n## ", 1);
  const section = nextHeader === -1 ? rest : rest.slice(0, nextHeader);

  const hasSubsection = /^### (Added|Changed|Deprecated|Removed|Fixed|Security)/m.test(
    section,
  );
  check(
    "Entry has at least one subsection (Added/Changed/Fixed/etc.)",
    hasSubsection,
    "Add a ### subsection under the version entry",
  );
}

// 4. (strict) Unreleased section is not empty
if (strict) {
  const unreleasedIdx = changelog.indexOf("## [Unreleased]");
  if (unreleasedIdx !== -1) {
    const afterUnreleased = changelog.slice(unreleasedIdx + "## [Unreleased]".length);
    const nextVersionIdx = afterUnreleased.indexOf("\n## [");
    const unreleasedContent = nextVersionIdx === -1
      ? afterUnreleased
      : afterUnreleased.slice(0, nextVersionIdx);
    const hasContent = unreleasedContent.trim().length > 0;
    check(
      "[Unreleased] section has content",
      hasContent,
      "The [Unreleased] section is empty — add entries before releasing",
    );
  }
}

console.log("");
if (failed) {
  console.error("Changelog checks failed.");
  process.exit(1);
} else {
  console.log(`Changelog OK for v${version}.`);
}
