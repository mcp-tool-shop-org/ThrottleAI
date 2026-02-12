import { describe, it, expect } from "vitest";
import { clampRetry, RETRY_MIN_MS, RETRY_MAX_MS } from "../src/utils/retry.js";

describe("clampRetry", () => {
  it("returns value unchanged when within bounds", () => {
    expect(clampRetry(100)).toBe(100);
    expect(clampRetry(1_000)).toBe(1_000);
    expect(clampRetry(3_000)).toBe(3_000);
  });

  it("clamps below minimum to RETRY_MIN_MS (25ms)", () => {
    expect(clampRetry(0)).toBe(RETRY_MIN_MS);
    expect(clampRetry(-100)).toBe(RETRY_MIN_MS);
    expect(clampRetry(1)).toBe(RETRY_MIN_MS);
    expect(clampRetry(24)).toBe(RETRY_MIN_MS);
  });

  it("clamps above maximum to RETRY_MAX_MS (5000ms)", () => {
    expect(clampRetry(10_000)).toBe(RETRY_MAX_MS);
    expect(clampRetry(60_000)).toBe(RETRY_MAX_MS);
    expect(clampRetry(5_001)).toBe(RETRY_MAX_MS);
  });

  it("rounds to nearest integer", () => {
    expect(clampRetry(100.7)).toBe(101);
    expect(clampRetry(100.3)).toBe(100);
  });

  it("boundary values are inclusive", () => {
    expect(clampRetry(RETRY_MIN_MS)).toBe(RETRY_MIN_MS);
    expect(clampRetry(RETRY_MAX_MS)).toBe(RETRY_MAX_MS);
  });
});
