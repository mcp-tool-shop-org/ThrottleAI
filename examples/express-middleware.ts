/**
 * ThrottleAI — Express middleware example
 *
 * Throttles an /ai endpoint with concurrency and rate limiting.
 *
 * This is a conceptual example — install express to run:
 *   pnpm add express @types/express
 *   npx tsx examples/express-middleware.ts
 */

import { createGovernor, type AcquireRequest } from "../src/index.js";

const gov = createGovernor({
  concurrency: { maxInFlight: 5, interactiveReserve: 2 },
  rate: { requestsPerMinute: 60 },
  leaseTtlMs: 30_000,
});

/**
 * Express-compatible middleware factory.
 *
 * Usage:
 * ```ts
 * import express from "express";
 * const app = express();
 * app.use("/ai", throttleMiddleware());
 * ```
 */
export function throttleMiddleware() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (req: any, res: any, next: any) => {
    const request: AcquireRequest = {
      actorId: req.headers["x-actor-id"] ?? req.ip ?? "anonymous",
      action: req.path,
      priority: req.headers["x-priority"] === "background" ? "background" : "interactive",
    };

    const decision = gov.acquire(request);

    if (!decision.granted) {
      res.status(429).json({
        error: "Too many requests",
        reason: decision.reason,
        retryAfterMs: decision.retryAfterMs,
        recommendation: decision.recommendation,
      });
      return;
    }

    // Attach lease cleanup to response finish
    const leaseId = decision.leaseId;
    res.on("finish", () => {
      gov.release(leaseId, {
        outcome: res.statusCode < 400 ? "success" : "error",
      });
    });

    next();
  };
}

// -- Demo without Express (just shows the middleware shape) --
console.log("ThrottleAI — Express Middleware Example");
console.log("=======================================\n");
console.log("This is a conceptual example showing the middleware pattern.");
console.log("Install express and uncomment the server code to run it.\n");

// Simulate a few requests
for (let i = 0; i < 8; i++) {
  const decision = gov.acquire({
    actorId: `user-${i}`,
    action: "/ai/chat",
    priority: "interactive",
  });

  if (decision.granted) {
    console.log(`Request ${i + 1}: ✓ Granted (lease: ${decision.leaseId.slice(0, 20)}...)`);
    gov.release(decision.leaseId, { outcome: "success" });
  } else {
    console.log(`Request ${i + 1}: ✗ Denied — ${decision.reason} (retry in ${decision.retryAfterMs}ms)`);
  }
}

gov.dispose();
