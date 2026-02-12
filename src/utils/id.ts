import { randomUUID } from "node:crypto";

export function newLeaseId(): string {
  return `lease-${randomUUID()}`;
}
