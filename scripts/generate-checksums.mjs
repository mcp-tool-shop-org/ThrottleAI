#!/usr/bin/env node

/**
 * Generate SHA-256 checksums for release artifacts.
 *
 * Outputs checksums.txt in the current directory.
 *
 * Usage:
 *   node scripts/generate-checksums.mjs <file1> [file2] ...
 *   node scripts/generate-checksums.mjs *.tgz
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error("Usage: node scripts/generate-checksums.mjs <file1> [file2] ...");
  process.exit(1);
}

const lines = [];

for (const file of files) {
  const content = readFileSync(file);
  const hash = createHash("sha256").update(content).digest("hex");
  const name = basename(file);
  lines.push(`${hash}  ${name}`);
  console.log(`${hash}  ${name}`);
}

writeFileSync("checksums.txt", lines.join("\n") + "\n");
console.log("\nWritten to checksums.txt");
