/**
 * Internal clock abstraction.
 *
 * Production code uses `now()` which defaults to `Date.now()`.
 * Tests inject a fake clock via `setNow()` for deterministic behavior.
 */

/** Clock interface — a function that returns the current time in ms. */
export type Clock = () => number;

/** Injectable clock — defaults to `Date.now()`. Swap in tests for deterministic time. */
let _now: Clock = () => Date.now();

export function now(): number {
  return _now();
}

/** Replace the clock function (for tests). */
export function setNow(fn: Clock): void {
  _now = fn;
}

/** Reset to real `Date.now()`. Always call in afterEach. */
export function resetNow(): void {
  _now = () => Date.now();
}

export function msUntil(target: number): number {
  return Math.max(0, target - now());
}

/**
 * Create a test clock with a mutable `time` property.
 *
 * ```ts
 * const clock = createTestClock(100_000);
 * setNow(clock.fn);
 * clock.time += 5000; // advance 5 seconds
 * ```
 */
export function createTestClock(startMs = 100_000): {
  time: number;
  fn: Clock;
  advance: (ms: number) => void;
} {
  const clock = {
    time: startMs,
    fn: () => clock.time,
    advance: (ms: number) => { clock.time += ms; },
  };
  return clock;
}
