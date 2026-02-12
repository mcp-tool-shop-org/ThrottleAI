import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TokenRatePool } from "../src/pools/tokenRate.js";
import { Governor } from "../src/governor.js";
import { setNow, resetNow } from "../src/utils/time.js";
import { RETRY_MAX_MS } from "../src/utils/retry.js";

describe("TokenRatePool", () => {
  let time: number;

  beforeEach(() => {
    time = 100_000;
    setNow(() => time);
  });

  afterEach(() => {
    resetNow();
  });

  it("allows tokens within the budget", () => {
    const pool = new TokenRatePool({ tokensPerMinute: 1_000, windowMs: 60_000 });

    expect(pool.tryAcquire(500).ok).toBe(true);
    pool.record(500);

    expect(pool.tryAcquire(400).ok).toBe(true);
    pool.record(400);

    expect(pool.currentTokens).toBe(900);
  });

  it("denies when tokens exceed budget", () => {
    const pool = new TokenRatePool({ tokensPerMinute: 1_000, windowMs: 60_000 });

    pool.tryAcquire(800);
    pool.record(800);

    const denied = pool.tryAcquire(300);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe("rate");
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("window slides: old entries expire, freeing budget", () => {
    const pool = new TokenRatePool({ tokensPerMinute: 1_000, windowMs: 10_000 });

    pool.tryAcquire(800);
    pool.record(800); // at 100_000

    time = 101_000;
    pool.tryAcquire(100);
    pool.record(100); // at 101_000

    // Full (900) — should deny 200 more
    expect(pool.tryAcquire(200).ok).toBe(false);

    // Advance past first entry's window
    time = 110_001;
    // 800 tokens from t=100_000 expired, only 100 from t=101_000 remains
    expect(pool.currentTokens).toBe(100);
    expect(pool.tryAcquire(800).ok).toBe(true);
  });

  it("updateActual adjusts token count down", () => {
    const pool = new TokenRatePool({ tokensPerMinute: 1_000, windowMs: 60_000 });

    pool.tryAcquire(500);
    pool.record(500, "lease-1");

    pool.tryAcquire(500);
    pool.record(500, "lease-2");

    expect(pool.currentTokens).toBe(1_000);

    // Actual usage for lease-1 was only 200
    pool.updateActual("lease-1", 200);
    expect(pool.currentTokens).toBe(700);

    // Now we can fit 300 more
    expect(pool.tryAcquire(300).ok).toBe(true);
  });

  it("updateActual adjusts token count up", () => {
    const pool = new TokenRatePool({ tokensPerMinute: 1_000, windowMs: 60_000 });

    pool.tryAcquire(200);
    pool.record(200, "lease-1");

    // Actual usage was 500 (more than estimated)
    pool.updateActual("lease-1", 500);
    expect(pool.currentTokens).toBe(500);
  });

  it("updateActual is a no-op for unknown leaseId", () => {
    const pool = new TokenRatePool({ tokensPerMinute: 1_000, windowMs: 60_000 });

    pool.tryAcquire(500);
    pool.record(500);

    pool.updateActual("unknown", 100);
    expect(pool.currentTokens).toBe(500); // unchanged
  });

  it("retryAfterMs is computed from entry expiry", () => {
    const pool = new TokenRatePool({ tokensPerMinute: 100, windowMs: 10_000 });

    pool.tryAcquire(80);
    pool.record(80); // at 100_000

    time = 101_000;
    pool.tryAcquire(30);
    pool.record(30); // at 101_000

    // 110 > 100, need to free at least 10 tokens
    // Oldest entry (80 tokens at 100_000) expires at 110_000 → 9_000ms from now
    // But clamped to 5_000
    const denied = pool.tryAcquire(10);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterMs).toBe(RETRY_MAX_MS);
  });

  it("retryAfterMs within clamp bounds", () => {
    const pool = new TokenRatePool({ tokensPerMinute: 100, windowMs: 5_000 });

    pool.tryAcquire(80);
    pool.record(80); // at 100_000

    time = 103_000;
    // Entry expires at 105_000 → 2_000ms from now
    const denied = pool.tryAcquire(30);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterMs).toBe(2_000);
  });
});

describe("Governor — token-rate integration", () => {
  let gov: Governor;
  let time: number;

  beforeEach(() => {
    time = 10_000;
    setNow(() => time);
  });

  afterEach(() => {
    gov?.dispose();
    resetNow();
  });

  it("denies when estimated tokens exceed tokensPerMinute", () => {
    gov = new Governor({
      rate: { tokensPerMinute: 1_000, windowMs: 60_000 },
      leaseTtlMs: 60_000,
    });

    // First call: 600 tokens
    const d1 = gov.acquire({
      actorId: "a",
      action: "chat",
      estimate: { promptTokens: 400, maxOutputTokens: 200 },
    });
    expect(d1.granted).toBe(true);
    expect(gov.tokenRateCount).toBe(600);

    // Second call: 500 tokens → total would be 1100 > 1000
    const d2 = gov.acquire({
      actorId: "a",
      action: "chat",
      estimate: { promptTokens: 300, maxOutputTokens: 200 },
    });
    expect(d2.granted).toBe(false);
    if (!d2.granted) {
      expect(d2.reason).toBe("rate");
      expect(d2.recommendation).toContain("token");
    }
  });

  it("both request-rate and token-rate can be active simultaneously", () => {
    gov = new Governor({
      rate: { requestsPerMinute: 10, tokensPerMinute: 500, windowMs: 60_000 },
      leaseTtlMs: 60_000,
    });

    // First call uses 400 tokens
    const d1 = gov.acquire({
      actorId: "a",
      action: "chat",
      estimate: { promptTokens: 200, maxOutputTokens: 200 },
    });
    expect(d1.granted).toBe(true);

    // Second call — within request limit (2/10) but exceeds token limit (500+200=700>500)
    const d2 = gov.acquire({
      actorId: "a",
      action: "chat",
      estimate: { promptTokens: 100, maxOutputTokens: 200 },
    });
    expect(d2.granted).toBe(false);
    if (!d2.granted) {
      expect(d2.reason).toBe("rate");
    }
  });

  it("release with actual usage updates token tracking", () => {
    gov = new Governor({
      rate: { tokensPerMinute: 1_000, windowMs: 60_000 },
      leaseTtlMs: 60_000,
    });

    // Estimate 800 tokens
    const d = gov.acquire({
      actorId: "a",
      action: "chat",
      estimate: { promptTokens: 500, maxOutputTokens: 300 },
    });
    expect(d.granted).toBe(true);
    if (!d.granted) return;

    expect(gov.tokenRateCount).toBe(800);

    // Actual usage was only 300 tokens
    gov.release(d.leaseId, {
      outcome: "success",
      usage: { promptTokens: 200, outputTokens: 100 },
    });

    expect(gov.tokenRateCount).toBe(300);
  });

  it("token-rate status getters", () => {
    gov = new Governor({
      rate: { tokensPerMinute: 5_000, windowMs: 60_000 },
      leaseTtlMs: 60_000,
    });

    expect(gov.tokenRateCount).toBe(0);
    expect(gov.tokenRateLimit).toBe(5_000);

    gov.acquire({
      actorId: "a",
      action: "chat",
      estimate: { promptTokens: 100, maxOutputTokens: 200 },
    });
    expect(gov.tokenRateCount).toBe(300);
  });

  it("token-rate not active when tokensPerMinute not configured", () => {
    gov = new Governor({
      rate: { requestsPerMinute: 5, windowMs: 60_000 },
      leaseTtlMs: 60_000,
    });

    expect(gov.tokenRateLimit).toBe(Infinity);
    expect(gov.tokenRateCount).toBe(0);
  });

  it("request with no estimate consumes 0 tokens", () => {
    gov = new Governor({
      rate: { tokensPerMinute: 100, windowMs: 60_000 },
      leaseTtlMs: 60_000,
    });

    // No estimate → 0 tokens
    const d = gov.acquire({ actorId: "a", action: "chat" });
    expect(d.granted).toBe(true);
    expect(gov.tokenRateCount).toBe(0);
  });

  it("token-rate denial does not leak concurrency slot", () => {
    gov = new Governor({
      concurrency: { maxInFlight: 10 },
      rate: { tokensPerMinute: 100, windowMs: 60_000 },
      leaseTtlMs: 60_000,
    });

    // Use up token budget
    gov.acquire({
      actorId: "a",
      action: "chat",
      estimate: { promptTokens: 80, maxOutputTokens: 20 },
    });
    expect(gov.concurrencyActive).toBe(1);

    // Token-rate denied — concurrency should not leak
    const denied = gov.acquire({
      actorId: "a",
      action: "chat",
      estimate: { promptTokens: 50 },
    });
    expect(denied.granted).toBe(false);
    expect(gov.concurrencyActive).toBe(1); // Only the first call
  });
});
