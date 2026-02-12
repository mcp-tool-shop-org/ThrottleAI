/**
 * Bundle sanity check — ensures core index.js does NOT import adapter code.
 *
 * Adapters live in separate entrypoints for tree-shaking. If the core
 * bundle accidentally imports adapter code, users pay for code they
 * don't use.
 */

import { readFileSync } from "node:fs";

const coreBundle = readFileSync("dist/index.js", "utf-8");

const adapterImports = [
  "adapters/express",
  "adapters/hono",
  "adapters/fetch",
  "adapters/openai",
  "adapters/tools",
];

let failed = false;

for (const adapter of adapterImports) {
  if (coreBundle.includes(adapter)) {
    console.error(`FAIL: dist/index.js contains "${adapter}" — core is pulling adapter code`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log("PASS: Core bundle does not import any adapter code");
}
