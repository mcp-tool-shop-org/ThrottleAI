/**
 * Load generator for the Express adaptive example.
 *
 * Sends waves of requests to /fast and /slow, so you can watch
 * the adaptive controller react in the server's stats output.
 *
 * Usage:
 *   1. Start the server:  npx tsx examples/express-adaptive/server.ts
 *   2. Run this script:   npx tsx examples/express-adaptive/load.ts
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

interface Result {
  route: string;
  status: number;
  ok: boolean;
  body: string;
}

async function hit(path: string, actor: string): Promise<Result> {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "x-actor-id": actor },
    });
    const body = await res.text();
    const elapsed = Date.now() - start;
    const tag = res.ok ? "✓" : res.status === 429 ? "⏳" : "✗";
    console.log(`  ${tag} ${res.status} ${path} actor=${actor} ${elapsed}ms`);
    return { route: path, status: res.status, ok: res.ok, body };
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`  ✗ ERR ${path} actor=${actor} ${elapsed}ms ${(err as Error).message}`);
    return { route: path, status: 0, ok: false, body: "" };
  }
}

async function wave(label: string, requests: Array<{ path: string; actor: string }>) {
  console.log(`\n--- ${label} (${requests.length} requests) ---`);
  const results = await Promise.all(requests.map((r) => hit(r.path, r.actor)));

  const granted = results.filter((r) => r.ok).length;
  const denied = results.filter((r) => r.status === 429).length;
  const errors = results.filter((r) => r.status >= 500).length;
  console.log(`  → granted=${granted} denied=${denied} errors=${errors}`);
}

async function main() {
  console.log("ThrottleAI Load Generator");
  console.log(`Target: ${BASE}\n`);

  // Wave 1: gentle — 3 fast requests
  await wave("Wave 1: Gentle warmup", [
    { path: "/fast", actor: "alice" },
    { path: "/fast", actor: "bob" },
    { path: "/fast", actor: "carol" },
  ]);

  await sleep(1000);

  // Wave 2: moderate — mix of fast and slow
  await wave("Wave 2: Mixed load", [
    { path: "/slow", actor: "alice" },
    { path: "/slow", actor: "bob" },
    { path: "/fast", actor: "carol" },
    { path: "/slow", actor: "dave" },
    { path: "/fast", actor: "alice" },
  ]);

  await sleep(2000);

  // Wave 3: heavy — saturate with slow requests
  await wave("Wave 3: Heavy (expect denials)", [
    { path: "/slow", actor: "alice" },
    { path: "/slow", actor: "bob" },
    { path: "/slow", actor: "carol" },
    { path: "/slow", actor: "dave" },
    { path: "/slow", actor: "eve" },
    { path: "/slow", actor: "frank" },
    { path: "/slow", actor: "grace" },
    { path: "/slow", actor: "heidi" },
  ]);

  await sleep(3000);

  // Wave 4: back to gentle — adaptive should recover
  await wave("Wave 4: Recovery", [
    { path: "/fast", actor: "alice" },
    { path: "/fast", actor: "bob" },
  ]);

  await sleep(5000);

  // Wave 5: final check — should be healthy again
  await wave("Wave 5: Steady state", [
    { path: "/slow", actor: "alice" },
    { path: "/slow", actor: "bob" },
    { path: "/fast", actor: "carol" },
  ]);

  // Print server stats
  console.log("\n--- Server stats ---");
  const statsRes = await fetch(`${BASE}/stats`);
  const statsBody = await statsRes.json();
  console.log(JSON.stringify(statsBody, null, 2));

  console.log("\nDone. Check the server output for adaptive behavior.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch(console.error);
