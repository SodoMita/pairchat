import type { RoomSnapshot } from "@/lib/chat";
import type { ConversationEncryption } from "@/lib/local-chats";
import type { EncryptedMessageEnvelope } from "@/lib/chat-events";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function isValidPrivateSecret(
  value: string | null | undefined,
): value is string {
  if (!value || !/^[A-Za-z0-9_-]{43}$/u.test(value)) return false;
  try {
    return fromBase64Url(value).byteLength === 32;
  } catch {
    return false;
  }
}

export function createPrivateSecret() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function privateSecretCommitment(secret: string) {
  if (!isValidPrivateSecret(secret)) throw new Error("Invalid private chat secret");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", fromBase64Url(secret)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createEcdhCredentials(): Promise<ConversationEncryption> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.exportKey("jwk", keyPair.privateKey),
    crypto.subtle.exportKey("jwk", keyPair.publicKey),
  ]);
  return { mode: "ecdh", privateKey, publicKey };
}

export function serializePublicKey(encryption: ConversationEncryption) {
  if (encryption.mode !== "ecdh") return null;
  return JSON.stringify(encryption.publicKey);
}

export async function ensureSigningCredentials(
  encryption: ConversationEncryption,
): Promise<ConversationEncryption> {
  if (encryption.signingPrivateKey && encryption.signingPublicKey) return encryption;
  const keyPair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const [signingPrivateKey, signingPublicKey] = await Promise.all([
    crypto.subtle.exportKey("jwk", keyPair.privateKey),
    crypto.subtle.exportKey("jwk", keyPair.publicKey),
  ]);
  return { ...encryption, signingPrivateKey, signingPublicKey };
}

export function serializeSigningKey(encryption: ConversationEncryption | undefined) {
  return encryption?.signingPublicKey
    ? JSON.stringify(encryption.signingPublicKey)
    : null;
}

export function envelopeSigningBytes(
  roomId: string,
  envelope: Omit<EncryptedMessageEnvelope, "signature">,
) {
  return encoder.encode(
    [
      "luma-signed-envelope-v1",
      roomId,
      envelope.id,
      envelope.senderPublicId,
      envelope.createdAt,
      envelope.iv,
      envelope.ciphertext,
    ].join("\n"),
  );
}

export function deliveryAckSigningBytes(
  roomId: string,
  messageId: string,
  recipientPublicId: string,
  receivedAt: string,
) {
  return encoder.encode(
    ["luma-delivery-ack-v1", roomId, messageId, recipientPublicId, receivedAt].join("\n"),
  );
}

export async function signDeliveryAck(
  encryption: ConversationEncryption | undefined,
  roomId: string,
  messageId: string,
  recipientPublicId: string,
  receivedAt: string,
) {
  if (!encryption?.signingPrivateKey) throw new Error("No local signing key");
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    encryption.signingPrivateKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    deliveryAckSigningBytes(roomId, messageId, recipientPublicId, receivedAt),
  );
  return toBase64Url(new Uint8Array(signature));
}

export async function verifyDeliveryAck(
  serializedPublicKey: string | null,
  roomId: string,
  messageId: string,
  recipientPublicId: string,
  receivedAt: string,
  signatureValue: string,
) {
  if (!serializedPublicKey) return false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      JSON.parse(serializedPublicKey) as JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      fromBase64Url(signatureValue),
      deliveryAckSigningBytes(roomId, messageId, recipientPublicId, receivedAt),
    );
  } catch {
    return false;
  }
}

export async function signEnvelope(
  encryption: ConversationEncryption | undefined,
  roomId: string,
  envelope: Omit<EncryptedMessageEnvelope, "signature">,
) {
  if (!encryption?.signingPrivateKey) throw new Error("No local signing key");
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    encryption.signingPrivateKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    envelopeSigningBytes(roomId, envelope),
  );
  return toBase64Url(new Uint8Array(signature));
}

export async function verifyEnvelopeSignature(
  serializedPublicKey: string | null,
  roomId: string,
  envelope: EncryptedMessageEnvelope,
) {
  if (!serializedPublicKey) return false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      JSON.parse(serializedPublicKey) as JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      fromBase64Url(envelope.signature),
      envelopeSigningBytes(roomId, envelope),
    );
  } catch {
    return false;
  }
}

async function importPrivateSecret(secret: string) {
  if (!isValidPrivateSecret(secret)) throw new Error("Invalid private chat secret");
  return crypto.subtle.importKey(
    "raw",
    fromBase64Url(secret),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function deriveRandomRoomBits(
  encryption: Extract<ConversationEncryption, { mode: "ecdh" }>,
  partnerPublicKey: string | null,
) {
  if (!partnerPublicKey) throw new Error("Partner encryption key is not ready");
  const partnerJwk = JSON.parse(partnerPublicKey) as JsonWebKey;
  // Older local credentials were exported with key_ops: ["deriveKey"].
  // ECDH permissions are local JWK metadata: import the same local scalar
  // with its actual required usage so existing conversations can derive bits.
  const privateJwk: JsonWebKey = {
    ...encryption.privateKey,
    key_ops: ["deriveBits"],
  };
  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.importKey(
      "jwk",
      privateJwk,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    ),
    crypto.subtle.importKey(
      "jwk",
      partnerJwk,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    ),
  ]);
  return crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256,
  );
}

async function deriveRandomRoomKey(
  encryption: Extract<ConversationEncryption, { mode: "ecdh" }>,
  room: Pick<RoomSnapshot, "id" | "partnerPublicKey">,
) {
  const bits = await deriveRandomRoomBits(encryption, room.partnerPublicKey);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    bits,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(room.id),
      info: encoder.encode("luma-e2ee-message-key-v1"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function getRoomCryptoKey(
  encryption: ConversationEncryption | undefined,
  room: Pick<RoomSnapshot, "id" | "partnerPublicKey">,
) {
  if (!encryption) throw new Error("No local encryption key for this chat");
  if (encryption.mode === "private") return importPrivateSecret(encryption.secret);
  return deriveRandomRoomKey(encryption, room);
}

export async function getRoomSafetyCode(
  encryption: ConversationEncryption | undefined,
  room: Pick<RoomSnapshot, "id" | "partnerPublicKey" | "partnerSigningKey">,
) {
  const ownSigningKey = serializeSigningKey(encryption);
  if (!encryption || !ownSigningKey || !room.partnerSigningKey) return "";
  const secret = encryption.mode === "private"
    ? fromBase64Url(encryption.secret)
    : new Uint8Array(await deriveRandomRoomBits(encryption, room.partnerPublicKey));
  const ownEncryptionKey = encryption.mode === "ecdh"
    ? JSON.stringify(encryption.publicKey)
    : "";
  const encryptionKeys = [ownEncryptionKey, room.partnerPublicKey ?? ""].sort();
  const signingKeys = [ownSigningKey, room.partnerSigningKey].sort();
  const commitment = encoder.encode(
    [
      "luma-safety-code-v2",
      room.id,
      ...encryptionKeys,
      ...signingKeys,
    ].join("\n"),
  );
  const combined = new Uint8Array(secret.byteLength + commitment.byteLength);
  combined.set(secret);
  combined.set(commitment, secret.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", combined));
  return Array.from(digest.slice(0, 6), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .match(/.{1,4}/gu)
    ?.join(" ") ?? "";
}

function additionalData(
  roomId: string,
  envelope: Pick<EncryptedMessageEnvelope, "id" | "senderPublicId" | "createdAt" | "version">,
) {
  return encoder.encode(
    `luma:${envelope.version}:${roomId}:${envelope.id}:${envelope.senderPublicId}:${envelope.createdAt}`,
  );
}

export async function encryptMessage(
  key: CryptoKey,
  roomId: string,
  senderPublicId: string,
  body: string,
): Promise<Omit<EncryptedMessageEnvelope, "signature">> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const envelope = {
    version: 1 as const,
    id: crypto.randomUUID(),
    senderPublicId,
    createdAt: new Date().toISOString(),
  };
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: additionalData(roomId, envelope),
      tagLength: 128,
    },
    key,
    encoder.encode(body),
  );
  return {
    ...envelope,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptMessage(
  key: CryptoKey,
  roomId: string,
  envelope: EncryptedMessageEnvelope,
) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64Url(envelope.iv),
      additionalData: additionalData(roomId, envelope),
      tagLength: 128,
    },
    key,
    fromBase64Url(envelope.ciphertext),
  );
  return decoder.decode(plaintext);
}

