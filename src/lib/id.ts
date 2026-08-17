import { randomUUID } from "node:crypto";

/** Short, URL-safe, sortable-enough primary key. */
export function createId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 24);
}
