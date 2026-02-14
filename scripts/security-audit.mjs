#!/usr/bin/env node

/**
 * Security audit helper — runs pnpm audit for prod and dev dependencies.
 *
 * Usage:
 *   node scripts/security-audit.mjs          # full audit
 *   node scripts/security-audit.mjs --prod   # prod-only (should always be clean)
 */

import { execSync } from "node:child_process";

const prodOnly = process.argv.includes("--prod");

function run(cmd, label) {
  console.log(`\n--- ${label} ---\n`);
  try {
    const out = execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    console.log(out || "No known vulnerabilities found");
    return true;
  } catch (err) {
    // pnpm audit exits non-zero when vulnerabilities exist
    console.log(err.stdout || err.message);
    return false;
  }
}

let ok = true;

// Prod audit — must always be clean (zero runtime deps)
const prodClean = run("pnpm audit --prod", "Production audit (runtime deps)");
if (!prodClean) {
  console.error("\nFAIL: production dependencies have known vulnerabilities!");
  ok = false;
}

if (!prodOnly) {
  // Full audit — informational, dev-only vulns are lower priority
  const fullClean = run("pnpm audit", "Full audit (including devDependencies)");
  if (!fullClean) {
    console.warn("\nWARN: devDependencies have known vulnerabilities (see above)");
    // Dev-only vulns are a warning, not a hard failure
  }
}

process.exit(ok ? 0 : 1);
