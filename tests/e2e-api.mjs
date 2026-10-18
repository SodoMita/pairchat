// End-to-end API tests for Chatterbox. Requires a running server and the
// database it uses:
//
//   BASE=http://localhost:3000 DATABASE_URL=postgresql://... node tests/e2e-api.mjs
//
// Exits non-zero on the first failure. These exercise the HTTP/SSE API with
// real WebCrypto (X25519 + AES-GCM); they do NOT drive a browser, so React
// client behaviour is covered only by typecheck/build, not here.
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const enc = (b) => Buffer.from(b).toString("base64url");
const dec = (s) => new Uint8Array(Buffer.from(s, "base64url"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execSync(`psql "${DB}" -At -c "${q}"`).toString().trim();

let passed = 0;
function check(name, cond, detail = "") {
  if (!cond) {
    console.error(`FAIL  ${name}${detail ? "  -> " + detail : ""}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`ok    ${name}`);
}

// ---- tiny cookie-aware client + SSE reader -------------------------------
function client() {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function f(path, init = {}) {
    const headers = new Headers(init.headers ?? {});
    if (jar.size) headers.set("cookie", cookie());
    const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
    const sc = res.headers.get("set-cookie");
    if (sc) {
      for (const part of sc.split(/,\s(?=[a-zA-Z][a-zA-Z0-9_-]*=)/)) {
        const [kv] = part.split(";");
        const i = kv.indexOf("=");
        jar.set(kv.slice(0, i), kv.slice(i + 1));
      }
    }
    return res;
  }
  const json = (path, method = "GET", body) =>
    f(path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  function sse(path) {
    const ctrl = new AbortController();
    const events = [];
    (async () => {
      try {
        const res = await fetch(BASE + path, {
          headers: { cookie: cookie() },
          signal: ctrl.signal,
        });
        if (!res.ok) return events.push({ event: "__http", data: { status: res.status } });
        const reader = res.body.getReader();
        const td = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += td.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(raw)?.[1];
            const data = /^data: (.+)$/m.exec(raw)?.[1];
            if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
          }
        }
      } catch {
        /* aborted */
      }
    })();
    return {
      events,
      close: () => ctrl.abort(),
      async wait(pred, ms = 5000) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const hit = events.find(pred);
          if (hit) return hit;
          await sleep(25);
        }
        return null;
      },
    };
  }
  return { f, json, sse, cookie };
}

// ---- crypto helpers (mirror src/lib/crypto.ts) ---------------------------
const subtle = crypto.subtle;
const gen = async (extractable = false) => {
  const k = await subtle.generateKey({ name: "X25519" }, extractable, ["deriveBits"]);
  return { priv: k.privateKey, pub: new Uint8Array(await subtle.exportKey("raw", k.publicKey)) };
};
const dh = async (priv, pub) =>
  new Uint8Array(
    await subtle.deriveBits(
      { name: "X25519", public: await subtle.importKey("raw", pub, { name: "X25519" }, false, []) },
      priv,
      256,
    ),
  );
const kdf = async (ikm, salt) =>
  new Uint8Array(
    await subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("chatterbox/v1/stranger") },
      await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]),
      256,
    ),
  );
const cat = (a, b) => Uint8Array.from([...a, ...b]);
async function seal(myPriv, peerPub, text) {
  const e = await gen(true);
  const key = await kdf(cat(await dh(myPriv, peerPub), await dh(e.priv, peerPub)), e.pub);
  const aes = await subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, aes, new TextEncoder().encode(text)));
  return { envelope: JSON.stringify({ v: 1, ct: enc(ct), iv: enc(iv) }), eph: enc(e.pub) };
}
async function open(myPriv, senderPub, ephB64, envJson) {
  const env = JSON.parse(envJson);
  const ep = dec(ephB64);
  const key = await kdf(cat(await dh(myPriv, senderPub), await dh(myPriv, ep)), ep);
  const aes = await subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  try {
    return new TextDecoder().decode(
      await subtle.decrypt({ name: "AES-GCM", iv: dec(env.iv), tagLength: 128 }, aes, dec(env.ct)),
    );
  } catch {
    return null;
  }
}
const roomSeal = async (key, text) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, aes, new TextEncoder().encode(text)));
  return JSON.stringify({ v: 1, ct: enc(ct), iv: enc(iv) });
};

// ===========================================================================
async function staticPages() {
  console.log("\n# Pages are static and only reference our own origin");
  const roomId = crypto.randomUUID();
  for (const path of ["/", "/chat/stranger", "/join", "/local", "/local/abc123", `/room/${roomId}`, "/icon.svg"]) {
    const res = await fetch(BASE + path);
    const html = await res.text();
    const cc = res.headers.get("cache-control") ?? "";
    check(`${path} -> 200`, res.status === 200, String(res.status));
    if (path === "/icon.svg") {
      // Must not force a conditional request on every page load.
      check(`${path} is browser-cached (no per-load revalidation)`, /max-age=([1-9]\d{3,})/.test(cc), cc);
    } else {
      check(`${path} is cacheable static output`, /s-maxage=\d+/.test(cc), cc);
    }
    check(`${path} sets no cookie`, !res.headers.get("set-cookie"));
    const csp = res.headers.get("content-security-policy") ?? "";
    check(`${path} CSP restricts connect-src to 'self'`, /connect-src 'self'(;|$)/.test(csp), csp);
    if (path !== "/icon.svg") {
      const refs = [...html.matchAll(/(?:src|href|action)="([^"]+)"/g)].map((m) => m[1]);
      const external = refs.filter((u) => /^(https?:)?\/\//.test(u));
      check(`${path} loads nothing from other origins`, external.length === 0, external.join(", "));
    }
  }
}

async function strangerFlow() {
  console.log("\n# Stranger: pushed pairing + key exchange, E2EE, plaintext rejected");
  sql("DELETE FROM messages; DELETE FROM matchmaking; DELETE FROM rooms; DELETE FROM users;");
  const A = client(), B = client();
  const ak = await gen(), bk = await gen();

  const a1 = await (await A.json("/api/stranger/start", "POST")).json();
  check("A queued and told who they are", a1.state === "queued" && !!a1.me?.id);
  const aEvents = A.sse("/api/stranger/events");
  check("A's stream reports queued", !!(await aEvents.wait((e) => e.event === "state" && e.data.state === "queued")));

  const b1 = await (await B.json("/api/stranger/start", "POST")).json();
  check("B pairs immediately", b1.state === "paired" && !!b1.sessionId);
  const paired = await aEvents.wait((e) => e.event === "paired");
  check("A is PUSHED the pairing (no polling)", paired?.data.sessionId === b1.sessionId);
  const bEvents = B.sse("/api/stranger/events");

  check("rejects a malformed public key", (await B.json("/api/stranger/start", "PATCH", { identityPubKey: "nope" })).status === 400);
  await A.json("/api/stranger/start", "PATCH", { identityPubKey: enc(ak.pub) });
  await B.json("/api/stranger/start", "PATCH", { identityPubKey: enc(bk.pub) });
  const gotB = await aEvents.wait((e) => e.event === "partner_key");
  const gotA = await bEvents.wait((e) => e.event === "partner_key" || (e.event === "state" && e.data.partnerKey));
  check("A is pushed B's key", gotB?.data.key === enc(bk.pub));
  check("B receives A's key", (gotA?.data.key ?? gotA?.data.partnerKey) === enc(ak.pub));

  const sid = b1.sessionId;
  const m1 = await seal(ak.priv, bk.pub, "Alice → Bob 🤫");
  const m2 = await seal(bk.priv, ak.pub, "Bob → Alice 🔐");
  for (const [c, m] of [[A, m1], [B, m2]]) {
    const r = await c.json(`/api/stranger/messages/${sid}`, "POST", { envelope: m.envelope, ephemeralPubKey: m.eph });
    check("server accepts an encrypted envelope", r.ok);
  }
  check("Bob decrypts Alice", (await open(bk.priv, ak.pub, m1.eph, m1.envelope)) === "Alice → Bob 🤫");
  check("Alice decrypts Bob", (await open(ak.priv, bk.pub, m2.eph, m2.envelope)) === "Bob → Alice 🔐");
  check("a third party's key cannot decrypt", (await open((await gen()).priv, ak.pub, m1.eph, m1.envelope)) === null);
  const tampered = JSON.parse(m1.envelope);
  const ctb = dec(tampered.ct); ctb[0] ^= 1; tampered.ct = enc(ctb);
  check("a flipped ciphertext bit is rejected (GCM tag)", (await open(bk.priv, ak.pub, m1.eph, JSON.stringify(tampered))) === null);

  check("plaintext POST is refused", (await A.json(`/api/stranger/messages/${sid}`, "POST", { text: "hello in clear" })).status === 400);
  const rows = sql(`SELECT body FROM messages WHERE scope='stranger:${sid}'`).split("\n");
  check("database holds only envelopes", rows.length === 2 && rows.every((r) => r.startsWith('{"v":1,')));
  check("no plaintext fragment is in the database", !rows.join("").includes("Alice") && !rows.join("").includes("Bob"));

  await A.json("/api/stranger/start", "DELETE");
  check("B is PUSHED partner_left", !!(await bEvents.wait((e) => e.event === "partner_left")));
  aEvents.close(); bEvents.close();
}

async function roomFlow() {
  console.log("\n# Room: one-request entry, invite codes, passphrase, seats, push");
  sql("DELETE FROM messages; DELETE FROM matchmaking; DELETE FROM rooms; DELETE FROM users;");
  const host = client(), guest = client(), eve = client();
  const created = await (await host.json("/api/rooms", "POST", { passphrase: "open sesame" })).json();
  const { id, inviteCode } = created.room;

  const h = await (await host.json(`/api/rooms/${id}/enter`, "POST")).json();
  check("host enters with role=host and no partner", h.room.role === "host" && h.partner === null && !!h.me.id);

  const hostStream = host.sse(`/api/rooms/${id}/messages`);
  await hostStream.wait((e) => e.event === "ready");

  check("guest without passphrase -> 401", (await guest.json(`/api/rooms/${id}/enter`, "POST")).status === 401);
  check("wrong passphrase -> 401", (await guest.json(`/api/rooms/${id}/enter`, "POST", { passphrase: "nope" })).status === 401);
  const g = await (await guest.json(`/api/rooms/${inviteCode}/enter`, "POST", { passphrase: "open sesame" })).json();
  check("guest resolves an INVITE CODE to the real room id", g.room.id === id && g.room.role === "guest");
  check("guest learns the host's name", g.partner?.displayName === h.me.displayName);
  const joined = await hostStream.wait((e) => e.data?.type === "guest_joined");
  check("host is PUSHED guest_joined with a name", joined?.data.displayName === g.me.displayName);

  check("a third user is refused (room full)", (await eve.json(`/api/rooms/${id}/enter`, "POST", { passphrase: "open sesame" })).status === 409);
  const eveStream = eve.sse(`/api/rooms/${id}/messages`);
  check("a non-participant cannot open the stream", !!(await eveStream.wait((e) => e.event === "__http" && e.data.status === 403)));
  eveStream.close();
  check("host re-entering is idempotent", (await host.json(`/api/rooms/${id}/enter`, "POST")).ok);

  const key = crypto.getRandomValues(new Uint8Array(32));
  const env = await roomSeal(key, "room secret 🔒");
  check("host can post an envelope", (await host.json(`/api/rooms/${id}/messages`, "POST", { envelope: env })).ok);
  check("plaintext POST is refused", (await host.json(`/api/rooms/${id}/messages`, "POST", { text: "clear" })).status === 400);
  const row = sql(`SELECT body FROM messages WHERE scope='room:${id}'`);
  check("room database row is an envelope without plaintext", row.startsWith('{"v":1,') && !row.includes("secret"));
  check("room key was never sent to the server", sql(`SELECT count(*) FROM rooms WHERE passphrase_hash LIKE '%${enc(key).slice(0, 10)}%'`) === "0");

  const guestStream = guest.sse(`/api/rooms/${id}/messages`);
  await guestStream.wait((e) => e.event === "ready");
  await host.json(`/api/rooms/${id}`, "DELETE");
  check("guest is PUSHED room_closed", !!(await guestStream.wait((e) => e.data?.type === "room_closed")));
  check("entering a closed room -> 410", (await guest.json(`/api/rooms/${id}/enter`, "POST", { passphrase: "open sesame" })).status === 410);
  check("malformed reference -> 404", (await guest.json("/api/rooms/not-a-room/enter", "POST")).status === 404);
  check("unknown invite code -> 404", (await guest.json("/api/rooms/AAAAAAAAAA/enter", "POST")).status === 404);
  hostStream.close(); guestStream.close();
}

async function statsEndpoint() {
  console.log("\n# Stats: one cacheable request serves status + counters");
  const res = await fetch(BASE + "/api/stats");
  const body = await res.json();
  check("stats 200 with all counters", res.ok && ["waiting", "activeChats", "totalMessages", "totalRooms"].every((k) => typeof body[k] === "number"));
  check("stats is HTTP-cacheable", /max-age=5/.test(res.headers.get("cache-control") ?? ""));
}

await staticPages();
await statsEndpoint();
await strangerFlow();
await roomFlow();
console.log(`\nAll ${passed} checks passed.`);
process.exit(0);
