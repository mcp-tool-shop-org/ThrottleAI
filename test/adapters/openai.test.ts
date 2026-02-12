import { describe, it, expect, afterEach } from "vitest";
import { createGovernor } from "../../src/createGovernor.js";
import {
  wrapChatCompletions,
  estimateTokensFromChars,
  estimateTokensFromMessages,
} from "../../src/adapters/openai.js";
import type { Governor } from "../../src/governor.js";
import type { OpenAILikeResponse } from "../../src/adapters/openai.js";

/** Fake OpenAI-compatible response. */
function fakeCompletion(
  content: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number },
): OpenAILikeResponse {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content } }],
    usage,
  };
}

/** Fake create function that resolves after a delay. */
function fakeCreateFn(
  content = "Hello!",
  delayMs = 10,
  usage?: { prompt_tokens?: number; completion_tokens?: number },
) {
  let callCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fn = async (_params: unknown) => {
    callCount++;
    await new Promise((r) => setTimeout(r, delayMs));
    return fakeCompletion(content, usage);
  };
  return { fn, getCallCount: () => callCount };
}

describe("wrapChatCompletions", () => {
  let gov: Governor | null = null;

  afterEach(() => {
    gov?.dispose();
    gov = null;
  });

  it("passes through a successful completion", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 5 } });
    const { fn } = fakeCreateFn("world", 10, {
      prompt_tokens: 5,
      completion_tokens: 3,
    });
    const throttled = wrapChatCompletions(fn, { governor: gov });

    const result = await throttled({ model: "gpt-4", messages: [] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.choices[0].message.content).toBe("world");
      expect(result.usage).toEqual({
        promptTokens: 5,
        outputTokens: 3,
      });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns denied when governor denies", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });
    const { fn } = fakeCreateFn("hi", 50);
    const throttled = wrapChatCompletions(fn, { governor: gov });

    // First call holds the lease
    const p1 = throttled({ model: "gpt-4", messages: [] });

    // Second call denied
    const result2 = await throttled({ model: "gpt-4", messages: [] });

    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.decision.reason).toBe("concurrency");
    }

    await p1;
  });

  it("releases lease on error", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 1 } });
    const throwFn = async () => {
      throw new Error("API error");
    };
    const { fn: okFn } = fakeCreateFn("ok", 5);
    const throttledThrow = wrapChatCompletions(throwFn, { governor: gov });
    const throttledOk = wrapChatCompletions(okFn, { governor: gov });

    await expect(
      throttledThrow({ model: "gpt-4", messages: [] }),
    ).rejects.toThrow("API error");

    // Lease released — next call should succeed
    const r2 = await throttledOk({ model: "gpt-4", messages: [] });
    expect(r2.ok).toBe(true);
  });

  it("uses custom actorId and action", async () => {
    const events: { actorId?: string; action?: string }[] = [];
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      onEvent: (e) => {
        if (e.type === "acquire") events.push(e);
      },
    });
    const { fn } = fakeCreateFn();
    const throttled = wrapChatCompletions(fn, {
      governor: gov,
      actorId: "alice",
      action: "embeddings",
    });

    await throttled({});

    expect(events[0].actorId).toBe("alice");
    expect(events[0].action).toBe("embeddings");
  });

  it("passes token estimate to governor", async () => {
    gov = createGovernor({
      concurrency: { maxInFlight: 5 },
      rate: { tokensPerMinute: 100_000 },
    });
    const { fn } = fakeCreateFn();
    const throttled = wrapChatCompletions(fn, { governor: gov });

    await throttled(
      { model: "gpt-4", messages: [] },
      { promptTokens: 500, maxOutputTokens: 200 },
    );

    expect(gov.tokenRateCount).toBe(700);
  });

  it("handles response without usage gracefully", async () => {
    gov = createGovernor({ concurrency: { maxInFlight: 5 } });
    const { fn } = fakeCreateFn("hi", 5); // no usage
    const throttled = wrapChatCompletions(fn, { governor: gov });

    const result = await throttled({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usage).toBeUndefined();
    }
  });
});

describe("estimation helpers", () => {
  it("estimateTokensFromChars uses ~4 chars/token", () => {
    expect(estimateTokensFromChars(100)).toBe(25);
    expect(estimateTokensFromChars(7)).toBe(2); // ceil(7/4) = 2
    expect(estimateTokensFromChars(0)).toBe(0);
  });

  it("estimateTokensFromMessages includes per-message overhead", () => {
    const messages = [
      { role: "system", content: "You are a helper." },
      { role: "user", content: "Hello" },
    ];

    const estimate = estimateTokensFromMessages(messages);

    // Content: "You are a helper." (17) + "system" (6) + "Hello" (5) + "user" (4) = 32 chars
    // 32/4 = 8 + 2*4 (overhead) = 16
    expect(estimate).toBe(16);
  });

  it("handles messages with null content", () => {
    const messages = [
      { role: "assistant", content: null },
      { role: "user", content: "Hi" },
    ];

    const estimate = estimateTokensFromMessages(messages);
    // "assistant"(9) + 0 + "user"(4) + "Hi"(2) = 15 chars → ceil(15/4) = 4 + 2*4 = 12
    expect(estimate).toBe(12);
  });
});
