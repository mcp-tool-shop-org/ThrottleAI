/**
 * AdaptiveController — self-tunes effective concurrency based on
 * observed latency and deny rate.
 *
 * - EMA (exponential moving average) for smooth signals
 * - Reduces effective concurrency when deny rate is high or latency climbing
 * - Increases effective concurrency when healthy
 * - maxInFlight from config is the ceiling; adaptive never exceeds it
 */

export interface AdaptiveConfig {
  /** EMA smoothing factor (0–1, default 0.2). Higher = more responsive. */
  alpha?: number;
  /** Target deny rate (0–1, default 0.05 = 5%). Above this → reduce concurrency. */
  targetDenyRate?: number;
  /** Latency increase ratio that triggers reduction (default 1.5 = 50% above baseline). */
  latencyThreshold?: number;
  /** How often to recalculate in ms (default 5_000). */
  adjustIntervalMs?: number;
  /** Minimum effective concurrency (default 1). */
  minConcurrency?: number;
}

const DEFAULT_ALPHA = 0.2;
const DEFAULT_TARGET_DENY_RATE = 0.05;
const DEFAULT_LATENCY_THRESHOLD = 1.5;
const DEFAULT_ADJUST_INTERVAL_MS = 5_000;
const DEFAULT_MIN_CONCURRENCY = 1;

export class AdaptiveController {
  private readonly _alpha: number;
  private readonly _targetDenyRate: number;
  private readonly _latencyThreshold: number;
  private readonly _adjustIntervalMs: number;
  private readonly _minConcurrency: number;
  private readonly _maxConcurrency: number;

  private _effectiveConcurrency: number;

  // EMA state
  private _emaLatency = 0;
  private _baselineLatency = 0;
  private _emaDenyRate = 0;

  // Counters for current interval
  private _intervalAcquires = 0;
  private _intervalDenials = 0;
  private _latencySamples: number[] = [];

  private _lastAdjust = 0;
  private _hasBaseline = false;

  constructor(maxConcurrency: number, config: AdaptiveConfig = {}) {
    this._alpha = config.alpha ?? DEFAULT_ALPHA;
    this._targetDenyRate = config.targetDenyRate ?? DEFAULT_TARGET_DENY_RATE;
    this._latencyThreshold = config.latencyThreshold ?? DEFAULT_LATENCY_THRESHOLD;
    this._adjustIntervalMs = config.adjustIntervalMs ?? DEFAULT_ADJUST_INTERVAL_MS;
    this._minConcurrency = config.minConcurrency ?? DEFAULT_MIN_CONCURRENCY;
    this._maxConcurrency = maxConcurrency;

    // Start at max — let the adaptive controller scale down if needed
    this._effectiveConcurrency = maxConcurrency;
  }

  /** Current effective concurrency (the pool should use this, not maxInFlight directly). */
  get effectiveConcurrency(): number {
    return this._effectiveConcurrency;
  }

  /** Record a successful acquire. */
  recordAcquire(): void {
    this._intervalAcquires++;
  }

  /** Record a denial. */
  recordDenial(): void {
    this._intervalDenials++;
  }

  /** Record the latency of a completed request in ms. */
  recordLatency(latencyMs: number): void {
    if (latencyMs > 0) {
      this._latencySamples.push(latencyMs);
    }
  }

  /**
   * Called periodically (or on every acquire/release) to check if adjustment is due.
   * @param now Current timestamp in ms.
   * @returns The new effective concurrency (may be unchanged).
   */
  maybeAdjust(now: number): number {
    if (this._lastAdjust === 0) {
      this._lastAdjust = now;
      return this._effectiveConcurrency;
    }

    if (now - this._lastAdjust < this._adjustIntervalMs) {
      return this._effectiveConcurrency;
    }

    this._adjust();
    this._lastAdjust = now;
    return this._effectiveConcurrency;
  }

  private _adjust(): void {
    const total = this._intervalAcquires + this._intervalDenials;

    // Update deny rate EMA
    if (total > 0) {
      const intervalDenyRate = this._intervalDenials / total;
      this._emaDenyRate =
        this._alpha * intervalDenyRate + (1 - this._alpha) * this._emaDenyRate;
    }

    // Update latency EMA
    if (this._latencySamples.length > 0) {
      const avgLatency =
        this._latencySamples.reduce((a, b) => a + b, 0) /
        this._latencySamples.length;

      this._emaLatency =
        this._alpha * avgLatency + (1 - this._alpha) * this._emaLatency;

      // Set baseline from first interval with data
      if (!this._hasBaseline) {
        this._baselineLatency = avgLatency;
        this._hasBaseline = true;
      }
    }

    // Decision: scale down or up
    const shouldReduce = this._shouldReduce();
    const shouldIncrease = this._shouldIncrease();

    if (shouldReduce) {
      // Reduce by 1 (conservative)
      this._effectiveConcurrency = Math.max(
        this._minConcurrency,
        this._effectiveConcurrency - 1,
      );
    } else if (shouldIncrease) {
      // Increase by 1 (conservative)
      this._effectiveConcurrency = Math.min(
        this._maxConcurrency,
        this._effectiveConcurrency + 1,
      );
    }

    // Reset interval counters
    this._intervalAcquires = 0;
    this._intervalDenials = 0;
    this._latencySamples = [];
  }

  private _shouldReduce(): boolean {
    // Reduce if deny rate exceeds target
    if (this._emaDenyRate > this._targetDenyRate) {
      return true;
    }

    // Reduce if latency has climbed significantly above baseline
    if (
      this._hasBaseline &&
      this._baselineLatency > 0 &&
      this._emaLatency > this._baselineLatency * this._latencyThreshold
    ) {
      return true;
    }

    return false;
  }

  private _shouldIncrease(): boolean {
    // Only increase when things are healthy:
    // - deny rate well below target
    // - latency stable or below baseline
    // - not already at max
    if (this._effectiveConcurrency >= this._maxConcurrency) {
      return false;
    }

    const denyHealthy = this._emaDenyRate < this._targetDenyRate * 0.5;
    const latencyHealthy =
      !this._hasBaseline ||
      this._baselineLatency === 0 ||
      this._emaLatency <= this._baselineLatency * 1.1;

    return denyHealthy && latencyHealthy;
  }
}
