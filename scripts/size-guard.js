/**
 * Size guard — ensures the core ESM bundle stays under a threshold.
 *
 * Prevents accidental bundle-size regressions from creeping in.
 * Adjust MAX_CORE_KB as the library grows.
 */

import { statSync } from "node:fs";

const MAX_CORE_KB = 50; // max core ESM bundle size in KB

const files = [
  { path: "dist/index.js", maxKb: MAX_CORE_KB, label: "Core ESM" },
];

let failed = false;

for (const { path, maxKb, label } of files) {
  try {
    const stat = statSync(path);
    const kb = stat.size / 1024;
    const status = kb <= maxKb ? "PASS" : "FAIL";

    console.log(`${status}: ${label} (${path}) — ${kb.toFixed(1)} KB (max: ${maxKb} KB)`);

    if (kb > maxKb) {
      failed = true;
    }
  } catch (err) {
    console.error(`FAIL: ${path} not found — did you run "pnpm build"?`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log("\nAll size checks passed.");
}
