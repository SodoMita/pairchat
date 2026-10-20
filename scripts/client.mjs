#!/usr/bin/env node
// Single-file zero-dependency E2EE agent channel CLI (Node.js 18+).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const HELP = `Usage:
  node client.mjs "<origin>/c/<id>#<key>" read --last N [--wait S]
  node client.mjs "<origin>/c/<id>#<key>" post --from NAME --last N [--wait S] < message.txt
  node client.mjs "<origin>/c/<id>#<key>" delete
`;

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (argv.length < 2) {
  process.stderr.write(HELP);
  process.exit(2);
}

const rawUrl = argv[0];
const subcmd = argv[1];
if (subcmd !== "read" && subcmd !== "post" && subcmd !== "delete") {
  process.stderr.write(`Unknown command: ${subcmd}\n${HELP}`);
  process.exit(2);
}

let last = null;
let wait = 0;
let fromName = null;

for (let i = 2; i < argv.length; i++) {
  const flag = argv[i];
  const val = argv[i + 1];
  if (flag === "--last" && val !== undefined) {
    if (!/^-?(?:0|[1-9][0-9]*)$/u.test(val)) {
      process.stderr.write("Invalid --last integer.\n");
      process.exit(2);
    }
    last = Number(val);
    i++;
  } else if (flag === "--wait" && val !== undefined) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(val)) {
      process.stderr.write("Invalid --wait integer.\n");
      process.exit(2);
    }
    wait = Number(val);
    i++;
  } else if (flag === "--from" && val !== undefined && subcmd === "post") {
    fromName = val;
    i++;
  } else {
    process.stderr.write(`Invalid argument: ${flag}\n${HELP}`);
    process.exit(2);
  }
}

if ((subcmd === "read" || subcmd === "post") && (last === null || last < -1)) {
  process.stderr.write("--last N (N >= -1) is required.\n");
  process.exit(2);
}
if (subcmd === "post") {
  if (!fromName || !fromName.trim() || /[\x00-\x1f\x7f]/u.test(fromName)) {
    process.stderr.write("--from NAME must be non-empty and free of control characters.\n");
    process.exit(2);
  }
  fromName = fromName.trim();
}

function failRuntime(payload) {
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(rawUrl);
} catch {
  failRuntime({ error: "invalid_url" });
}

const pathMatch = /^\/c\/([A-Za-z0-9_-]{22})$/u.exec(parsed.pathname);
const keyFragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : "";
if (
  (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
  parsed.username ||
  parsed.password ||
  parsed.search ||
  !pathMatch ||
  !/^[A-Za-z0-9_-]{43}$/u.test(keyFragment)
) {
  failRuntime({ error: "invalid_channel_url" });
}

const channelId = pathMatch[1];
const keyBytes = Buffer.from(keyFragment, "base64url");
if (keyBytes.byteLength !== 32) {
  failRuntime({ error: "invalid_key_length" });
}

const derivedId = Buffer.from(
  hkdfSync("sha256", keyBytes, Buffer.alloc(0), Buffer.from("mayfly id", "utf8"), 16),
).toString("base64url");
if (derivedId !== channelId) {
  failRuntime({ error: "key_mismatch" });
}

const authBearer = Buffer.from(
  hkdfSync("sha256", keyBytes, Buffer.alloc(0), Buffer.from("mayfly auth", "utf8"), 32),
).toString("base64url");
const encKey = Buffer.from(
  hkdfSync("sha256", keyBytes, Buffer.alloc(0), Buffer.from("mayfly enc", "utf8"), 32),
);

function sealMessage(seq, from, text) {
  const inner = Buffer.from(JSON.stringify({ from, text }), "utf8");
  const rem = inner.byteLength % 256;
  const paddedLen = rem === 0 ? inner.byteLength : inner.byteLength + (256 - rem);
  const padded = Buffer.alloc(paddedLen, 0x20);
  inner.copy(padded, 0);

  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey, nonce);
  cipher.setAAD(Buffer.from(`${channelId}:${seq}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
  return {
    nonce: nonce.toString("base64url"),
    ct: encrypted.toString("base64url"),
  };
}

function openEvent(ev) {
  if (
    !ev ||
    typeof ev.seq !== "number" ||
    typeof ev.ts !== "string" ||
    typeof ev.src !== "string" ||
    typeof ev.nonce !== "string" ||
    typeof ev.ct !== "string"
  ) {
    failRuntime({ error: "malformed_event" });
  }
  let plain;
  try {
    const nonce = Buffer.from(ev.nonce, "base64url");
    const raw = Buffer.from(ev.ct, "base64url");
    if (nonce.byteLength !== 12 || raw.byteLength < 16) throw new Error("bad size");
    const tag = raw.subarray(raw.byteLength - 16);
    const data = raw.subarray(0, raw.byteLength - 16);
    const decipher = createDecipheriv("aes-256-gcm", encKey, nonce);
    decipher.setAAD(Buffer.from(`${channelId}:${ev.seq}`, "utf8"));
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return { id: ev.seq, ts: ev.ts, src: ev.src, from: "", text: "(undecryptable message)" };
  }
  try {
    const obj = JSON.parse(plain);
    if (
      !obj ||
      typeof obj !== "object" ||
      Array.isArray(obj) ||
      typeof obj.from !== "string" ||
      !obj.from.trim() ||
      /[\x00-\x1f\x7f]/u.test(obj.from) ||
      typeof obj.text !== "string" ||
      !obj.text.trim()
    ) {
      throw new Error("bad inner");
    }
    return { id: ev.seq, ts: ev.ts, src: ev.src, from: obj.from.trim(), text: obj.text };
  } catch {
    return { id: ev.seq, ts: ev.ts, src: ev.src, from: "", text: "(invalid message)" };
  }
}

let postText = "";
if (subcmd === "post") {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  postText = Buffer.concat(chunks).toString("utf8");
  if (!postText || !postText.trim()) {
    failRuntime({ error: "blank_message" });
  }
}

const base = `${parsed.origin}/c/${channelId}`;

if (subcmd === "delete") {
  let res;
  try {
    res = await fetch(base, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authBearer}` },
    });
  } catch (err) {
    failRuntime({ error: "transport_error", message: err instanceof Error ? err.message : String(err) });
  }
  if (res.status !== 204) {
    failRuntime({ error: "http_error", status: res.status });
  }
  process.stdout.write(`${JSON.stringify({ deleted: true })}\n`);
  process.exit(0);
}

const endpoint =
  subcmd === "read"
    ? `${base}/events?since=${last}&wait=${wait}`
    : `${base}/events?last=${last}&wait=${wait}`;

let response;
try {
  response = await fetch(endpoint, {
    method: subcmd === "read" ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${authBearer}`,
      ...(subcmd === "post" ? { "Content-Type": "application/json" } : {}),
    },
    ...(subcmd === "post" ? { body: JSON.stringify(sealMessage(last + 1, fromName, postText)) } : {}),
  });
} catch (err) {
  failRuntime({
    error: "transport_error",
    message: err instanceof Error ? err.message : String(err),
    ...(subcmd === "post" ? { posted: null } : {}),
  });
}

let body;
try {
  body = await response.json();
} catch {
  failRuntime({
    error: "bad_response",
    status: response.status,
    ...(subcmd === "post" ? { posted: null } : {}),
  });
}

if (subcmd === "post" && response.status === 409 && body?.error === "conflict" && Array.isArray(body.events)) {
  const messages = body.events.map(openEvent);
  process.stdout.write(
    `${JSON.stringify({
      posted: false,
      error: "conflict",
      last: body.last,
      more: Boolean(body.more),
      messages,
    })}\n`,
  );
  process.exit(1);
}

if (!response.ok || typeof body?.last !== "number" || typeof body?.more !== "boolean" || !Array.isArray(body?.events)) {
  failRuntime({
    error: body?.error || "http_error",
    status: response.status,
    ...(body?.posted !== undefined ? { posted: body.posted } : subcmd === "post" ? { posted: false } : {}),
  });
}

const messages = body.events.map(openEvent);
const out =
  subcmd === "post"
    ? { posted: true, id: body.id, last: body.last, more: body.more, messages }
    : { last: body.last, more: body.more, messages };

process.stdout.write(`${JSON.stringify(out)}\n`);
