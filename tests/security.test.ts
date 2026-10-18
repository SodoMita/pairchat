import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import { decryptMessage, deriveConversationKey, deriveRoomKey, encryptMessage, generateIdentityKeypair, generateRoomKey, hashProof, roomJoinProof, safetyCode } from "../src/lib/crypto";
import { decode64, encode64, parseEnvelope, validPublicKey } from "../src/lib/protocol";
import { hashPassphrase, verifyPassphrase } from "../src/lib/passphrase";
import { assertOrigin, HttpError, readJson } from "../src/lib/request-security";
import { consume } from "../src/lib/rateLimit";
import { usablePublicKey } from "../src/lib/public-key-validation";

test("real client crypto: bidirectional, self echo, context binding and tamper rejection", async () => {
  const a = await generateIdentityKeypair(), b = await generateIdentityKeypair();
  const scope = `stranger:${"A".repeat(21)}`;
  const ak = await deriveConversationKey(a, b.publicKey, scope), bk = await deriveConversationKey(b, a.publicKey, scope);
  assert.equal(a.privateKey.extractable, false);
  assert.equal(ak.extractable, false);
  assert.equal(await safetyCode(scope, a.publicKey, b.publicKey), await safetyCode(scope, b.publicKey, a.publicKey));
  for (const [sender, key, other] of [[randomUUID(), ak, bk], [randomUUID(), bk, ak]] as const) {
    const env = await encryptMessage(key, scope, sender, "Hello 🔐 <script>not executable</script>");
    const raw = JSON.stringify(env);
    assert.equal(await decryptMessage(other, raw, scope, sender), "Hello 🔐 <script>not executable</script>");
    assert.equal(await decryptMessage(key, raw, scope, sender), "Hello 🔐 <script>not executable</script>");
    assert.equal(await decryptMessage(other, raw, `stranger:${"B".repeat(21)}`, sender), null);
    for (const mutation of [{ sender: randomUUID() }, { id: randomUUID() }, { createdAt: new Date(0).toISOString() }]) {
      const bad = { ...env, ...mutation };
      assert.equal(await decryptMessage(other, JSON.stringify(bad), scope, bad.sender), null);
    }
    const ct = decode64(env.ct); ct[0] ^= 1;
    assert.equal(await decryptMessage(other, JSON.stringify({ ...env, ct: encode64(ct) }), scope, sender), null);
  }
});
test("private key separation: admission proof is not the encryption key", async () => {
  const { key, encoded } = generateRoomKey();
  const proof = await roomJoinProof(key), hash = await hashProof(proof);
  assert.notEqual(proof, encoded); assert.equal(hash.length, 64);
  const scope = `room:${randomUUID()}`, sender = randomUUID();
  const aes = await deriveRoomKey(key, scope);
  const env = JSON.stringify(await encryptMessage(aes, scope, sender, "private text"));
  const wrong = await deriveRoomKey(decode64(proof), scope);
  assert.equal(await decryptMessage(wrong, env, scope, sender), null);
  assert.equal(await decryptMessage(await deriveRoomKey(key, scope), env, scope, sender), "private text");
});
test("strict envelope and public-key validation rejects downgrade and garbage", () => {
  for (const input of ["null", "[]", "{}", '{"v":1,"ct":"hello","iv":"world"}', " ".repeat(12000)]) assert.equal(parseEnvelope(input), null);
  assert.equal(validPublicKey("A".repeat(43)), false);
  assert.equal(validPublicKey("x"), false);
  assert.throws(() => decode64("abcd=="));
});
test("scrypt uses independent salts and supports safe legacy migration", async () => {
  const password = "spaces and فارسی 🔑";
  const a = await hashPassphrase(password), b = await hashPassphrase(password);
  assert.match(a, /^scrypt\$32768\$8\$3\$/); assert.notEqual(a, b);
  assert.deepEqual(await verifyPassphrase(a, password), { valid: true, legacy: false });
  assert.equal((await verifyPassphrase(a, password + "x")).valid, false);
  const legacy = createHash("sha256").update(password).digest("hex");
  assert.deepEqual(await verifyPassphrase(legacy, password), { valid: true, legacy: true });
});
test("bounded reader rejects chunked oversize before buffering the whole stream", async () => {
  const empty = new ReadableStream<Uint8Array>({ start(c) { c.close(); } });
  assert.deepEqual(await readJson(new Request("http://localhost/api", { method: "POST", body: empty, duplex: "half" } as RequestInit & { duplex: string }), 1024, true), {});
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(4096)); }, cancel() { cancelled = true; } });
  const req = new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half" } as RequestInit & { duplex: string });
  await assert.rejects(readJson(req, 5000), (e: unknown) => e instanceof HttpError && e.status === 413);
  assert.equal(cancelled, true);
  for (const body of ["null", "[]", "{"]) {
    await assert.rejects(readJson(new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body })), (e: unknown) => e instanceof HttpError && e.status === 400);
  }
});
test("Origin and Fetch Metadata checks reject cross-site mutations", () => {
  assert.throws(() => assertOrigin(new Request("http://localhost/api", { headers: { host: "localhost", origin: "https://evil.example" } })), HttpError);
  assert.throws(() => assertOrigin(new Request("http://localhost/api", { headers: { host: "localhost", "sec-fetch-site": "cross-site" } })), HttpError);
  assert.throws(() => assertOrigin(new Request("http://localhost/api", { headers: { host: "localhost", origin: "null" } })), HttpError);
  const origin = process.env.APP_ORIGIN ?? "http://localhost";
  assert.doesNotThrow(() => assertOrigin(new Request(origin + "/api", { headers: { host: new URL(origin).host, origin } })));
});
test("token bucket enforces bursts", () => {
  const key = randomUUID();
  assert.equal(consume(key, 2, 0.1).ok, true); assert.equal(consume(key, 2, 0.1).ok, true); assert.equal(consume(key, 2, 0.1).ok, false);
});
