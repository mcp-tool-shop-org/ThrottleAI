/** Injectable clock — defaults to `Date.now()`. Swap in tests for deterministic time. */
let _now: () => number = () => Date.now();

export function now(): number {
  return _now();
}

export function setNow(fn: () => number): void {
  _now = fn;
}

export function resetNow(): void {
  _now = () => Date.now();
}

export function msUntil(target: number): number {
  return Math.max(0, target - now());
}
