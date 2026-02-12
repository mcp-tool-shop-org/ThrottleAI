/**
 * Cookbook: ThrottleAI Adapters — zero-dependency wrappers for
 * fetch, OpenAI, Express, Hono, and arbitrary tool calls.
 *
 * Each adapter returns a consistent shape:
 *   { ok: true, result, latencyMs }  — granted
 *   { ok: false, decision }           — denied
 *
 * Run: npx tsx examples/cookbook-adapters.ts
 */

import { createGovernor, presets } from "../src/index.js";
import { wrapFetch } from "../src/adapters/fetch.js";
import { wrapChatCompletions, estimateTokensFromMessages } from "../src/adapters/openai.js";
import { wrapTool } from "../src/adapters/tools.js";
import { throttleMiddleware } from "../src/adapters/express.js";
import { throttle } from "../src/adapters/hono.js";

const gov = createGovernor({
  ...presets.balanced(),
  onEvent: (e) => {
    if (e.type === "deny") {
      console.log(`  ⛔ Denied: ${e.reason} — ${e.recommendation}`);
    }
  },
});

// ── 1. fetch adapter ────────────────────────────────────────────────
async function demoFetch() {
  console.log("\n═══ fetch adapter ═══");

  // Wrap the global fetch (or any fetch-compatible function)
  const throttledFetch = wrapFetch(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_input, _init) => new Response("ok", { status: 200 }),
    { governor: gov, action: "api.call" },
  );

  const r = await throttledFetch("https://api.example.com/data");
  if (r.ok) {
    console.log(`  ✅ fetch succeeded in ${r.latencyMs}ms, status=${r.response.status}`);
  }
}

// ── 2. OpenAI adapter ───────────────────────────────────────────────
async function demoOpenAI() {
  console.log("\n═══ OpenAI adapter ═══");

  // Fake OpenAI-compatible create function
  const fakeCreate = async (params: { model: string; messages: { role: string; content: string }[] }) => {
    await new Promise((r) => setTimeout(r, 20));
    return {
      id: "chatcmpl-demo",
      object: "chat.completion" as const,
      choices: [{ index: 0, message: { role: "assistant", content: `Echo: ${params.messages[0]?.content}` } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
  };

  const throttledChat = wrapChatCompletions(fakeCreate, {
    governor: gov,
    actorId: "demo-user",
    action: "chat",
  });

  const messages = [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Hello!" },
  ];

  const estimate = estimateTokensFromMessages(messages);
  console.log(`  Token estimate: ~${estimate} tokens`);

  const r = await throttledChat(
    { model: "gpt-4", messages },
    { promptTokens: estimate, maxOutputTokens: 100 },
  );

  if (r.ok) {
    console.log(`  ✅ Chat completed in ${r.latencyMs}ms`);
    console.log(`  Reply: ${r.result.choices[0].message.content}`);
    if (r.usage) {
      console.log(`  Usage: ${r.usage.promptTokens} prompt + ${r.usage.outputTokens} output tokens`);
    }
  }
}

// ── 3. Tool adapter ─────────────────────────────────────────────────
async function demoTool() {
  console.log("\n═══ Tool adapter ═══");

  const embed = wrapTool(
    async (text: string) => {
      await new Promise((r) => setTimeout(r, 10));
      return Array.from({ length: 4 }, () => Math.random());
    },
    { governor: gov, toolId: "embed", costWeight: 2 },
  );

  const r = await embed("Hello world");
  if (r.ok) {
    console.log(`  ✅ Embedding [${r.result.map((v) => v.toFixed(3)).join(", ")}] in ${r.latencyMs}ms`);
  }
}

// ── 4. Express adapter ──────────────────────────────────────────────
function demoExpress() {
  console.log("\n═══ Express adapter ═══");

  const mw = throttleMiddleware({ governor: gov });

  // Simulate a request
  const req = { path: "/ai/chat", method: "POST", ip: "127.0.0.1", headers: {} };
  const res = {
    _status: 200,
    _body: null as unknown,
    statusCode: 200,
    status(code: number) { res._status = code; res.statusCode = code; return res; },
    json(body: unknown) { res._body = body; },
    setHeader() {},
    on(event: string, fn: () => void) { if (event === "finish") fn(); },
  };

  let nextCalled = false;
  mw(req, res as never, () => { nextCalled = true; });
  console.log(`  ✅ Express next() called: ${nextCalled}`);
}

// ── 5. Hono adapter ────────────────────────────────────────────────
async function demoHono() {
  console.log("\n═══ Hono adapter ═══");

  const mw = throttle({ governor: gov });

  const ctx = {
    req: {
      path: "/ai/generate",
      method: "POST",
      header: (name: string) => name === "x-actor-id" ? "demo-user" : undefined,
    },
    json: (body: unknown, status?: number) => new Response(JSON.stringify(body), { status: status ?? 200 }),
    header: () => {},
    set: (key: string, value: unknown) => {
      if (key === "throttleai_leaseId") {
        console.log(`  Lease stored on context: ${value}`);
      }
    },
  };

  await mw(ctx as never, async () => {
    console.log("  ✅ Hono next() called");
  });
}

// ── Run all demos ───────────────────────────────────────────────────
async function main() {
  console.log("ThrottleAI Adapters Cookbook");
  console.log("==========================");

  await demoFetch();
  await demoOpenAI();
  await demoTool();
  demoExpress();
  await demoHono();

  console.log("\n✅ All adapter demos completed!");

  gov.dispose();
}

main().catch(console.error);
