// Browser-side WebCrypto only. This is NOT a Signal/Double-Ratchet protocol.
// X25519 + HKDF yields a per-conversation key, then AES-256-GCM authenticates
// the room, sender, id and timestamp. Private keys never cross the network.
import { authenticatedData, decode64, encode64, MAX_TEXT, parseEnvelope, validScope, type Envelope } from "./protocol";
export { parseEnvelope } from "./protocol";
export type { Envelope } from "./protocol";
export const b64uEncode = encode64;
export const b64uDecode = decode64;
const bytes = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);
const utf8 = (s: string) => new TextEncoder().encode(s);
export type IdentityKeypair = { publicKey: Uint8Array; privateKey: CryptoKey };

export async function generateIdentityKeypair(): Promise<IdentityKeypair> {
  if (!globalThis.crypto?.subtle) throw new Error("Secure browser context required");
  const keys = await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]) as CryptoKeyPair;
  return { privateKey: keys.privateKey, publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)) };
}
const transcript = (scope: string, a: Uint8Array, b: Uint8Array) => utf8(JSON.stringify(["chatterbox/x25519/v2", scope, ...[encode64(a), encode64(b)].sort()]));
async function hkdf(secret: Uint8Array, salt: Uint8Array, info: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", bytes(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: bytes(salt), info: utf8(info) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function deriveConversationKey(own: IdentityKeypair, peer: Uint8Array, scope: string): Promise<CryptoKey> {
  if (!validScope(scope) || peer.length !== 32 || !peer.some(Boolean)) throw new Error("Invalid key context");
  const publicKey = await crypto.subtle.importKey("raw", bytes(peer), "X25519", false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, own.privateKey, 256));
  if (!shared.some(Boolean)) throw new Error("Invalid shared secret");
  const salt = new Uint8Array(await crypto.subtle.digest("SHA-256", transcript(scope, own.publicKey, peer)));
  try { return await hkdf(shared, salt, "chatterbox/text/v2"); } finally { shared.fill(0); }
}
export async function safetyCode(scope: string, a: Uint8Array, b: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", transcript(scope, a, b)));
  return [...hash].map(n => n.toString(16).padStart(2, "0")).join("").match(/.{1,8}/g)!.join(" ");
}
export async function deriveRoomKey(raw: Uint8Array, scope: string): Promise<CryptoKey> {
  if (raw.length !== 32 || !scope.startsWith("room:") || !validScope(scope)) throw new Error("Invalid room key");
  return hkdf(raw, utf8(scope), "chatterbox/private/text/v2");
}
export async function encryptMessage(key: CryptoKey, scope: string, sender: string, text: string): Promise<Envelope> {
  if (!text.trim() || text.length > MAX_TEXT) throw new Error("Invalid message length");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = { v: 2 as const, scope, sender, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: authenticatedData(header), tagLength: 128 }, key, utf8(text));
  return { ...header, iv: encode64(iv), ct: encode64(new Uint8Array(ct)) };
}
export async function decryptMessage(key: CryptoKey, encoded: string, scope: string, sender: string): Promise<string | null> {
  const envelope = parseEnvelope(encoded);
  if (!envelope || envelope.scope !== scope || envelope.sender !== sender) return null;
  try {
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(decode64(envelope.iv)), additionalData: authenticatedData(envelope), tagLength: 128 }, key, bytes(decode64(envelope.ct)));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return text.length <= MAX_TEXT && text.trim() ? text : null;
  } catch { return null; }
}
export function parseRoomKey(value: string): Uint8Array | null {
  try {
    if (value.length !== 43) return null;
    const raw = decode64(value);
    return raw.length === 32 ? raw : null;
  } catch { return null; }
}
export function generateRoomKey() {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return { key, encoded: encode64(key) };
}
// Domain-separated capability: the relay receives this proof, never the AES
// room secret. Its SHA-256 digest is persisted; that digest cannot be reused
// as the proof. Unique random room keys avoid cross-room capability reuse.
export async function roomJoinProof(raw: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", bytes(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return encode64(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8("chatterbox/private/admission/v1"))));
}
export async function hashProof(proof: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(proof)));
  return [...hash].map(x => x.toString(16).padStart(2, "0")).join("");
}
