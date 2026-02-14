#!/usr/bin/env node
/**
 * Print vitest + node versions for CI diagnostics.
 * Used by test-compat.yml to make vitest upgrades measurable.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const vitestPkg = require("vitest/package.json");

console.log("--- vitest env ---");
console.log(`  node:   ${process.version}`);
console.log(`  vitest: ${vitestPkg.version}`);
console.log(`  arch:   ${process.arch}`);
console.log(`  os:     ${process.platform}`);
console.log("------------------");
