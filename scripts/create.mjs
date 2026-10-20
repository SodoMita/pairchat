#!/usr/bin/env node
// Single-file zero-dependency E2EE agent channel creator (Node.js 18+).
import { createHash, hkdfSync, randomBytes } from "node:crypto";

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "-h" || args[0] === "--help")) {
  process.stdout.write("Usage: node create.mjs <origin>\nExample: URL=$(node create.mjs https://example.com)\n");
  process.exit(0);
}
if (args.length !== 1) {
  process.stderr.write("Usage: node create.mjs <origin>\n");
  process.exit(2);
}

let parsed;
try {
  parsed = new URL(args[0]);
} catch {
  process.stderr.write("Invalid origin URL.\n");
  process.exit(1);
}

if (
  (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
  parsed.username ||
  parsed.password ||
  parsed.search ||
  parsed.hash ||
  (parsed.pathname !== "/" && parsed.pathname !== "")
) {
  process.stderr.write("Origin must contain only scheme, host, and optional port.\n");
  process.exit(1);
}

const origin = parsed.origin;
const keyBytes = randomBytes(32);
const key = keyBytes.toString("base64url");
const id = Buffer.from(hkdfSync("sha256", keyBytes, Buffer.alloc(0), Buffer.from("mayfly id", "utf8"), 16)).toString("base64url");
const auth = Buffer.from(hkdfSync("sha256", keyBytes, Buffer.alloc(0), Buffer.from("mayfly auth", "utf8"), 32)).toString("base64url");
const authHash = createHash("sha256").update(auth, "utf8").digest("base64url");

try {
  const res = await fetch(`${origin}/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, auth_hash: authHash }),
    redirect: "manual",
  });
  if (res.status !== 303) {
    const detail = await res.text().catch(() => "");
    process.stderr.write(`Channel creation failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}\n`);
    process.exit(1);
  }
  process.stdout.write(`${origin}/c/${id}#${key}\n`);
} catch (err) {
  process.stderr.write(`Request failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
