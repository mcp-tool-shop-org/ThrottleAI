import type { GovernorEvent, GovernorSnapshot } from "./types.js";

/**
 * Format a governor event as a single human-readable log line.
 *
 * Does not log by itself — just returns a string.
 *
 * ```ts
 * const gov = createGovernor({
 *   onEvent: (e) => console.log(formatEvent(e)),
 * });
 * ```
 *
 * Example output:
 * ```
 * [acquire] actor=user-1 action=chat lease=abc-123 weight=1
 * [deny] actor=user-1 action=chat reason=concurrency retryAfterMs=500
 * [release] actor=user-1 action=chat lease=abc-123 outcome=success
 * [expire] actor=user-1 action=chat lease=abc-123
 * [warn] lease=abc-123 Lease held for 55000ms (92% of 60000ms TTL)
 * ```
 */
export function formatEvent(event: GovernorEvent): string {
  const parts: string[] = [`[${event.type}]`];

  if (event.actorId) parts.push(`actor=${event.actorId}`);
  if (event.action) parts.push(`action=${event.action}`);
  if (event.leaseId) parts.push(`lease=${event.leaseId.slice(0, 8)}`);

  switch (event.type) {
    case "acquire":
      if (event.weight && event.weight !== 1) parts.push(`weight=${event.weight}`);
      break;
    case "deny":
      if (event.reason) parts.push(`reason=${event.reason}`);
      if (event.retryAfterMs !== undefined) parts.push(`retryAfterMs=${event.retryAfterMs}`);
      if (event.recommendation) parts.push(`— ${event.recommendation}`);
      break;
    case "release":
      if (event.outcome) parts.push(`outcome=${event.outcome}`);
      if (event.weight && event.weight !== 1) parts.push(`weight=${event.weight}`);
      break;
    case "expire":
      break;
    case "warn":
      if (event.message) parts.push(event.message);
      break;
  }

  return parts.join(" ");
}

/**
 * Format a governor snapshot as a compact human-readable string.
 *
 * ```ts
 * console.log(formatSnapshot(gov.snapshot()));
 * // concurrency=3/5 rate=12/60 tokens=5000/100000 leases=3
 * ```
 */
export function formatSnapshot(snap: GovernorSnapshot): string {
  const parts: string[] = [];

  if (snap.concurrency) {
    parts.push(`concurrency=${snap.concurrency.inFlightWeight}/${snap.concurrency.effectiveMax}`);
  }
  if (snap.requestRate) {
    parts.push(`rate=${snap.requestRate.current}/${snap.requestRate.limit}`);
  }
  if (snap.tokenRate) {
    parts.push(`tokens=${snap.tokenRate.current}/${snap.tokenRate.limit}`);
  }
  parts.push(`leases=${snap.activeLeases}`);

  if (snap.lastDeny) {
    parts.push(`lastDeny=${snap.lastDeny.reason}`);
  }

  return parts.join(" ");
}
