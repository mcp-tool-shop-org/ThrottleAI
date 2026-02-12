/**
 * Cookbook #2 — Express 429 vs queue pattern
 *
 * Two approaches to handling denied requests:
 *   A) Return 429 immediately with retry guidance
 *   B) Queue and retry with waitForRetry()
 *
 * This is a conceptual example — install express to run a real server.
 * Run: npx tsx examples/cookbook-express-429.ts
 */

import {
  createGovernor,
  presets,
  waitForRetry,
  type AcquireDecision,
} from "../src/index.js";

const gov = createGovernor({
  ...presets.balanced(),
  strict: true,
  onEvent: (e) => {
    if (e.type === "warn") console.warn(`⚠ ${e.message}`);
  },
});

// ---------------------------------------------------------------------------
// Approach A: Return 429 immediately
// ---------------------------------------------------------------------------

function handle429(actorId: string): { status: number; body: object } {
  const decision = gov.acquire({ actorId, action: "/ai/chat" });

  if (!decision.granted) {
    return {
      status: 429,
      body: {
        error: "Too many requests",
        reason: decision.reason,
        retryAfterMs: decision.retryAfterMs,
        recommendation: decision.recommendation,
      },
    };
  }

  // Simulate work, then release
  gov.release(decision.leaseId, { outcome: "success" });
  return { status: 200, body: { message: "ok" } };
}

// ---------------------------------------------------------------------------
// Approach B: Queue with automatic retry
// ---------------------------------------------------------------------------

async function handleWithQueue(actorId: string): Promise<{ status: number; body: object }> {
  const maxAttempts = 3;

  let decision: AcquireDecision | null = null;
  for (let i = 0; i < maxAttempts; i++) {
    decision = gov.acquire({ actorId, action: "/ai/chat" });
    if (decision.granted) break;
    await waitForRetry(decision);
  }

  if (!decision || !decision.granted) {
    return {
      status: 503,
      body: {
        error: "Service temporarily unavailable",
        message: "Retries exhausted — try again later",
      },
    };
  }

  // Simulate work
  await new Promise((r) => setTimeout(r, 50));
  gov.release(decision.leaseId, { outcome: "success" });
  return { status: 200, body: { message: "ok (queued)" } };
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

async function main() {
  console.log("Cookbook #2 — Express 429 vs queue\n");

  // Approach A: immediate 429
  console.log("--- Approach A: Immediate 429 ---");
  for (let i = 0; i < 8; i++) {
    const { status, body } = handle429(`user-${i % 3}`);
    console.log(`  [${i}] ${status} ${JSON.stringify(body).slice(0, 80)}`);
  }

  console.log();

  // Approach B: queue + retry
  console.log("--- Approach B: Queue + retry ---");
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => handleWithQueue(`user-${i % 3}`)),
  );
  for (let i = 0; i < results.length; i++) {
    console.log(`  [${i}] ${results[i].status} ${JSON.stringify(results[i].body).slice(0, 80)}`);
  }

  gov.dispose();
}

main().catch(console.error);
