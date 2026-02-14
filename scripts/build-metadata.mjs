#!/usr/bin/env node

/**
 * Emit build metadata to dist/build-metadata.json.
 *
 * Captures commit SHA, build date, and Node version for provenance.
 * Run after `tsup` build.
 *
 * Usage:
 *   node scripts/build-metadata.mjs
 */

import { writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

let commitSha = "unknown";
try {
  commitSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
} catch {
  // Not in a git repo (e.g., npm install from tarball)
}

const metadata = {
  name: pkg.name,
  version: pkg.version,
  commitSha,
  buildDate: new Date().toISOString(),
  nodeVersion: process.version,
};

writeFileSync("dist/build-metadata.json", JSON.stringify(metadata, null, 2) + "\n");
console.log("Build metadata written to dist/build-metadata.json");
console.log(JSON.stringify(metadata, null, 2));
