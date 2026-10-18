import { createHash } from "node:crypto";

/** Hash a random browser bearer capability before storing or querying it in PostgreSQL. */
export function hashAccessCredential(accessCredential: string) {
  return createHash("sha256").update(accessCredential, "utf8").digest("hex");
}
