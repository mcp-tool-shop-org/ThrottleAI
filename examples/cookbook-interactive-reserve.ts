/**
 * Cookbook #3 — Interactive vs background with reserve slots
 *
 * Demonstrates how interactiveReserve protects UI-driven requests
 * when background batch jobs consume most of the capacity.
 *
 * Run: npx tsx examples/cookbook-interactive-reserve.ts
 */

import { createGovernor, presets } from "../src/index.js";
import type { GovernorEvent } from "../src/types.js";

const events: GovernorEvent[] = [];

const gov = createGovernor({
  ...presets.balanced(),
  // balanced = maxInFlight: 5, interactiveReserve: 2
  onEvent: (e) => events.push(e),
});

function status(): string {
  const s = gov.snapshot();
  const cc = s.concurrency!;
  return `[${cc.active}/${cc.max} active, ${cc.available} avail]`;
}

async function simulateWork(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("Cookbook #3 — Interactive vs background reserve\n");
  console.log("Config: maxInFlight=5, interactiveReserve=2");
  console.log("Background jobs can only use slots 1-3. Slots 4-5 are reserved for interactive.\n");

  // Step 1: Background batch jobs fill up non-reserve capacity
  console.log("Step 1: Submit 5 background jobs...");
  const bgLeases: string[] = [];

  for (let i = 0; i < 5; i++) {
    const d = gov.acquire({
      actorId: `batch-${i}`,
      action: "embed",
      priority: "background",
    });
    if (d.granted) {
      bgLeases.push(d.leaseId);
      console.log(`  bg-${i}: GRANTED ${status()}`);
    } else {
      console.log(`  bg-${i}: DENIED (${d.reason}) ${status()} — reserve protected!`);
    }
  }

  // Step 2: Interactive request arrives — should still get through
  console.log("\nStep 2: Interactive user request arrives...");
  const interactive = gov.acquire({
    actorId: "alice",
    action: "chat",
    priority: "interactive",
  });

  if (interactive.granted) {
    console.log(`  alice: GRANTED ${status()} — interactive reserve works!`);
    await simulateWork(50);
    gov.release(interactive.leaseId, { outcome: "success" });
  } else {
    console.log(`  alice: DENIED ${status()} — something wrong!`);
  }

  // Step 3: Another background request — should be denied (reserve full)
  console.log("\nStep 3: Another background job tries...");
  const bgExtra = gov.acquire({
    actorId: "batch-extra",
    action: "embed",
    priority: "background",
  });
  if (bgExtra.granted) {
    console.log(`  bg-extra: GRANTED ${status()}`);
    gov.release(bgExtra.leaseId, { outcome: "success" });
  } else {
    console.log(`  bg-extra: DENIED (${bgExtra.reason}) ${status()} — reserve protected!`);
  }

  // Cleanup
  for (const id of bgLeases) {
    gov.release(id, { outcome: "success" });
  }

  // Summary
  const denies = events.filter((e) => e.type === "deny").length;
  const acquires = events.filter((e) => e.type === "acquire").length;
  console.log(`\nSummary: ${acquires} granted, ${denies} denied`);

  gov.dispose();
}

main().catch(console.error);
