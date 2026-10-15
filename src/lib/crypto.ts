// Client-side encryption for Chatterbox. Message plaintext is encrypted in
// the browser with WebCrypto before it reaches any API or database.

const VERSION = 1;
const STRANGER_HKDF_INFO = "chatterbox/v1/stranger";

export function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(s.length / 4) * 4,
    "=",
  );
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export type Envelope = { v: number; ct: string; iv: string };

export function parseEnvelope(s: string): Envelope | null {
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === "object" && obj.v === VERSION &&
        typeof obj.ct === "string" && typeof obj.iv === "string") {
      return obj as Envelope;
    }
  } catch { /* ignore */ }
  return null;
}

export function isEnvelope(s: string): boolean {
  return parseEnvelope(s) !== null;
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptWithKey(key: Uint8Array, plaintext: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ck = await importAesKey(key);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, tagLength: 128 },
    ck,
    new TextEncoder().encode(plaintext) as BufferSource,
  );
  return { v: VERSION, ct: b64uEncode(new Uint8Array(ct)), iv: b64uEncode(iv) };
}

export async function decryptWithKey(key: Uint8Array, env: Envelope): Promise<string | null> {
  try {
    const ck = await importAesKey(key);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64uDecode(env.iv) as BufferSource, tagLength: 128 },
      ck,
      b64uDecode(env.ct) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

// ---------- X25519 stranger-chat identity keys ----------

export type IdentityKeypair = { publicKey: Uint8Array; privateKey: CryptoKey };

export async function generateIdentityKeypair(): Promise<IdentityKeypair> {
  const kp = (await crypto.subtle.generateKey(
    { name: "X25519" }, false, ["deriveBits"],
  )) as CryptoKeyPair;
  return {
    publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)),
    privateKey: kp.privateKey,
  };
}

/** Persist non-extractable CryptoKeys locally, never on the server. */
export async function loadOrCreateIdentityKeypair(storageId: string): Promise<IdentityKeypair> {
  const candidate = await generateIdentityKeypair();
  if (typeof indexedDB === "undefined") return candidate;
  try {
    const database = await openIdentityDatabase();
    return await new Promise<IdentityKeypair>((resolve, reject) => {
      const tx = database.transaction("identity-keys", "readwrite");
      const store = tx.objectStore("identity-keys");
      const req = store.get(storageId);
      req.onsuccess = () => {
        const existing = req.result as IdentityKeypair | undefined;
        if (existing?.privateKey && existing?.publicKey) {
          resolve({ privateKey: existing.privateKey, publicKey: new Uint8Array(existing.publicKey) });
        } else {
          store.put(candidate, storageId);
          resolve(candidate);
        }
      };
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  } catch {
    // Storage can be blocked in private browsing/restricted contexts.
    // Keep this page usable; reloaded history may then be undecryptable.
    return candidate;
  }
}

function openIdentityDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("chatterbox-e2ee", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("identity-keys")) {
        request.result.createObjectStore("identity-keys");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function importPeerPub(rawPub: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawPub as BufferSource, { name: "X25519" }, false, []);
}

async function deriveSharedBits(myPriv: CryptoKey, theirPub: Uint8Array): Promise<Uint8Array> {
  const peer = await importPeerPub(theirPub);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: peer }, myPriv, 256));
}

async function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: "HKDF", hash: "SHA-256", salt: salt as BufferSource,
    info: new TextEncoder().encode(info) as BufferSource,
  }, base, 256));
}

async function generateEphemeralKeypair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
}

export async function deriveStrangerMessageKey(params: {
  myStaticPriv: CryptoKey;
  partnerStaticPub: Uint8Array;
}): Promise<{ key: Uint8Array; ephemeralPub: Uint8Array }> {
  const staticShared = await deriveSharedBits(params.myStaticPriv, params.partnerStaticPub);
  const eph = await generateEphemeralKeypair();
  const ephShared = await deriveSharedBits(eph.privateKey, params.partnerStaticPub);
  const ephemeralPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const ikm = new Uint8Array(staticShared.length + ephShared.length);
  ikm.set(staticShared, 0);
  ikm.set(ephShared, staticShared.length);
  const key = await hkdfSha256(ikm, ephemeralPub, STRANGER_HKDF_INFO);
  return { key, ephemeralPub };
}

/**
 * Receiver computes the same two X25519 secrets by ECDH symmetry:
 * ECDH(receiver_static_priv, sender_static_pub) and
 * ECDH(receiver_static_priv, sender_ephemeral_pub).
 */
export async function deriveStrangerMessageKeyAtReceiver(params: {
  myStaticPriv: CryptoKey;
  senderStaticPub: Uint8Array;
  senderEphemeralPub: Uint8Array;
}): Promise<Uint8Array> {
  const staticShared = await deriveSharedBits(params.myStaticPriv, params.senderStaticPub);
  const ephShared = await deriveSharedBits(params.myStaticPriv, params.senderEphemeralPub);
  const ikm = new Uint8Array(staticShared.length + ephShared.length);
  ikm.set(staticShared, 0);
  ikm.set(ephShared, staticShared.length);
  return hkdfSha256(ikm, params.senderEphemeralPub, STRANGER_HKDF_INFO);
}

export async function sealStrangerMessage(
  plaintext: string,
  myStaticPriv: CryptoKey,
  partnerStaticPub: Uint8Array,
): Promise<{ envelope: Envelope; ephemeralPub: Uint8Array }> {
  const { key, ephemeralPub } = await deriveStrangerMessageKey({ myStaticPriv, partnerStaticPub });
  return { envelope: await encryptWithKey(key, plaintext), ephemeralPub };
}

export async function openStrangerMessage(
  envelope: Envelope,
  myStaticPriv: CryptoKey,
  senderStaticPub: Uint8Array,
  senderEphemeralPub: Uint8Array,
): Promise<string | null> {
  const key = await deriveStrangerMessageKeyAtReceiver({ myStaticPriv, senderStaticPub, senderEphemeralPub });
  return decryptWithKey(key, envelope);
}

// ---------- Private-room keys ----------

export function parseRoomKey(raw: string): Uint8Array | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === 64) {
      const out = new Uint8Array(32);
      for (let i = 0; i < 32; i += 1) out[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    const decoded = b64uDecode(trimmed);
    return decoded.length === 32 ? decoded : null;
  } catch { return null; }
}

export function generateRoomKey(): { key: Uint8Array; encoded: string } {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return { key, encoded: b64uEncode(key) };
}

export async function sealRoomMessage(plaintext: string, roomKey: Uint8Array): Promise<Envelope> {
  return encryptWithKey(roomKey, plaintext);
}
export async function openRoomMessage(env: Envelope, roomKey: Uint8Array): Promise<string | null> {
  return decryptWithKey(roomKey, env);
}
