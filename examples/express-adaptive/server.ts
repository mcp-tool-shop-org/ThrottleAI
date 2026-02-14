/**
 * ThrottleAI — Express adaptive example
 *
 * A runnable Express server demonstrating:
 *   - Middleware wiring with `throttleMiddleware`
 *   - Adaptive concurrency reacting to latency and errors
 *   - Periodic stats printing (grants, denials, avg latency)
 *
 * Install & run:
 *   pnpm add express @types/express
 *   npx tsx examples/express-adaptive/server.ts
 *
 * Then hit it with:
 *   curl http://localhost:3000/fast        # always quick
 *   curl http://localhost:3000/slow        # simulated latency + occasional errors
 *
 * Or run the built-in load test:
 *   npx tsx examples/express-adaptive/load.ts
 */

import express from "express";
import {
  createGovernor,
  formatSnapshot,
  type GovernorEvent,
} from "../../src/index.js";
import { throttleMiddleware } from "../../src/adapters/express.js";

// ---------------------------------------------------------------------------
// Governor: adaptive tuning enabled, tight limits to show behavior quickly
// ---------------------------------------------------------------------------

const stats = { grants: 0, denials: 0, totalLatencyMs: 0, releases: 0 };

const gov = createGovernor({
  concurrency: { maxInFlight: 4, interactiveReserve: 1 },
  rate: { requestsPerMinute: 120 },
  leaseTtlMs: 15_000,
  adaptive: {
    adjustIntervalMs: 3_000, // fast feedback loop for demo
    targetDenyRate: 0.1,
    latencyThreshold: 1.5,
    minConcurrency: 1,
  },
  onEvent: (e: GovernorEvent) => {
    if (e.type === "acquire") stats.grants++;
    if (e.type === "deny") stats.denials++;
    if (e.type === "release" && e.outcome) {
      stats.releases++;
    }
  },
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// Apply throttle middleware to all /fast and /slow routes
app.use(
  throttleMiddleware({
    governor: gov,
    getActorId: (req) => (req.headers["x-actor-id"] as string) ?? req.ip ?? "anon",
    getAction: (req) => req.path,
  }),
);

// GET /fast — always quick, always succeeds
app.get("/fast", (_req, res) => {
  res.json({ route: "fast", message: "ok", ts: Date.now() });
});

// GET /slow — simulated latency (200-800ms) + 20% error rate
app.get("/slow", async (_req, res) => {
  const latency = 200 + Math.random() * 600;
  await new Promise((r) => setTimeout(r, latency));

  if (Math.random() < 0.2) {
    res.status(500).json({ route: "slow", error: "simulated failure" });
    return;
  }

  res.json({ route: "slow", message: "ok", latencyMs: Math.round(latency) });
});

// GET /stats — governor snapshot + request stats
app.get("/stats", (_req, res) => {
  const snap = gov.snapshot();
  res.json({
    governor: formatSnapshot(snap),
    snapshot: snap,
    stats: {
      grants: stats.grants,
      denials: stats.denials,
      denyRate:
        stats.grants + stats.denials > 0
          ? (stats.denials / (stats.grants + stats.denials)).toFixed(3)
          : "0",
    },
  });
});

// ---------------------------------------------------------------------------
// Periodic stats log
// ---------------------------------------------------------------------------

const statsInterval = setInterval(() => {
  const snap = gov.snapshot();
  const total = stats.grants + stats.denials;
  const denyRate = total > 0 ? ((stats.denials / total) * 100).toFixed(1) : "0.0";
  const effectiveMax = snap.concurrency?.effectiveMax ?? "—";

  console.log(
    `[stats] ${formatSnapshot(snap)} | grants=${stats.grants} denials=${stats.denials} denyRate=${denyRate}% effectiveMax=${effectiveMax}`,
  );
}, 5_000);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3000);
const server = app.listen(PORT, () => {
  console.log(`\nThrottleAI Express Adaptive Example`);
  console.log(`====================================`);
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`\nRoutes:`);
  console.log(`  GET /fast   — always quick`);
  console.log(`  GET /slow   — simulated latency + 20% errors`);
  console.log(`  GET /stats  — governor snapshot + request stats`);
  console.log(`\nConfig:`);
  console.log(`  maxInFlight: 4, interactiveReserve: 1`);
  console.log(`  adaptive: adjustInterval=3s, targetDenyRate=10%`);
  console.log(`\nHit it with: curl http://localhost:${PORT}/slow`);
  console.log(`Or run: npx tsx examples/express-adaptive/load.ts\n`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  clearInterval(statsInterval);
  gov.dispose();
  server.close(() => {
    console.log("\nShutdown complete.");
    process.exit(0);
  });
});
