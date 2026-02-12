/**
 * Cookbook #1 — Burst load + snapshot monitoring
 *
 * Simulates a burst of 20 requests arriving at once, using presets.balanced().
 * Prints a one-line health status after each acquire/release cycle.
 *
 * Run: npx tsx examples/cookbook-burst-snapshot.ts
 */

import { createGovernor, presets } from "../src/index.js";

const gov = createGovernor({
  ...presets.balanced(),
  onEvent: (e) => {
    if (e.type === "deny") {
      console.log(`  ⚡ deny: ${e.actorId} — ${e.reason} (retry ${e.retryAfterMs}ms)`);
    }
  },
});

function healthLine(): string {
  const s = gov.snapshot();
  const cc = s.concurrency;
  const rr = s.requestRate;
  return (
    `leases=${s.activeLeases} ` +
    `concurrency=${cc ? `${cc.active}/${cc.effectiveMax}` : "off"} ` +
    `rate=${rr ? `${rr.current}/${rr.limit}` : "off"} ` +
    `fairness=${s.fairness ? "on" : "off"}`
  );
}

async function simulate(id: number): Promise<void> {
  const decision = gov.acquire({
    actorId: `user-${id % 5}`, // 5 distinct actors
    action: "chat.completion",
  });

  if (!decision.granted) {
    return; // deny event already printed
  }

  // Simulate work
  await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
  gov.release(decision.leaseId, { outcome: "success" });
}

async function main() {
  console.log("Cookbook #1 — Burst load + snapshot\n");

  // Fire 20 requests in a burst
  const tasks = Array.from({ length: 20 }, (_, i) => simulate(i));
  await Promise.allSettled(tasks);

  console.log(`\nFinal: ${healthLine()}`);
  gov.dispose();
}

main().catch(console.error);
