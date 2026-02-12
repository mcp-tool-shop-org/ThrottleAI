/**
 * ThrottleAI — Basic Node.js example
 *
 * Simulates 5 concurrent "model calls" with maxInFlight=2.
 * Run: npx tsx examples/node-basic.ts
 */

import { createGovernor, withLease } from "../src/index.js";

const gov = createGovernor({
  concurrency: { maxInFlight: 2, interactiveReserve: 1 },
  rate: { requestsPerMinute: 10 },
  leaseTtlMs: 30_000,
});

async function simulateModelCall(id: number): Promise<string> {
  const delay = 500 + Math.random() * 1_000;
  await new Promise((r) => setTimeout(r, delay));
  return `Model response for request ${id} (took ${Math.round(delay)}ms)`;
}

async function main() {
  console.log("ThrottleAI — Basic Example");
  console.log("==========================\n");
  console.log(`Config: maxInFlight=2, interactiveReserve=1, rate=10/min\n`);

  const tasks = Array.from({ length: 5 }, (_, i) => i + 1);

  const results = await Promise.allSettled(
    tasks.map(async (id) => {
      const priority = id <= 2 ? "interactive" : "background";
      console.log(`[${id}] Requesting lease (${priority})...`);

      const result = await withLease(
        gov,
        {
          actorId: `user-${id}`,
          action: "chat.completion",
          priority,
          estimate: { promptTokens: 500, maxOutputTokens: 200 },
        },
        async () => {
          console.log(`[${id}] Lease granted — calling model...`);
          return await simulateModelCall(id);
        },
        { wait: true, maxWaitMs: 10_000, initialBackoffMs: 200 },
      );

      if (result.granted) {
        console.log(`[${id}] ✓ ${result.result}`);
      } else {
        console.log(`[${id}] ✗ Denied: ${result.decision.reason} (retry in ${result.decision.retryAfterMs}ms)`);
      }
    }),
  );

  console.log(`\nDone. ${results.filter((r) => r.status === "fulfilled").length}/5 completed.`);
  gov.dispose();
}

main().catch(console.error);
