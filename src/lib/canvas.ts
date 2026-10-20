import type { RoomSnapshot } from "@/lib/chat";
import type { ConversationEncryption } from "@/lib/local-chats";
import { getCanvasCryptoKey } from "@/lib/e2ee";

export const CANVAS_PROTOCOL = 1;
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 540;
export const CANVAS_MAX_POINTS = 48;
export const CANVAS_MAX_STROKES = 80;
export const CANVAS_BRUSHES = ["#1e2927", "#ff6747", "#5d7d54", "#3b6ea5"] as const;
export const CANVAS_SIZES = [3, 6, 12] as const;

export type CanvasEventType =
  | "invite"
  | "accept"
  | "decline"
  | "disable"
  | "stroke"
  | "undo"
  | "clear-self"
  | "reset-request"
  | "reset-approve";

export type CanvasPoint = { x: number; y: number };

export type CanvasPlainEvent =
  | {
      type: "invite";
      protocol: typeof CANVAS_PROTOCOL;
      width: number;
      height: number;
      units: "normalized";
      brushes: string[];
    }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "disable" }
  | {
      type: "stroke";
      tool: "brush" | "eraser";
      color: string;
      size: number;
      points: CanvasPoint[];
    }
  | { type: "undo" }
  | { type: "clear-self" }
  | { type: "reset-request"; generation: number }
  | { type: "reset-approve"; generation: number };

export type CanvasEnvelope = {
  version: 1;
  id: string;
  iv: string;
  ciphertext: string;
  signature: string;
  senderPublicId: string;
  createdAt: string;
  sessionId: string;
  seq: number;
  eventType: CanvasEventType;
  boardGeneration: number;
};

export type CanvasStroke = {
  tool: "brush" | "eraser";
  color: string;
  size: number;
  points: CanvasPoint[];
};

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

export function isCanvasEnvelope(value: unknown): value is CanvasEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<CanvasEnvelope>;
  const createdAt = Date.parse(envelope.createdAt ?? "");
  return (
    envelope.version === 1 &&
    typeof envelope.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(envelope.id) &&
    typeof envelope.iv === "string" &&
    /^[A-Za-z0-9_-]{16}$/u.test(envelope.iv) &&
    typeof envelope.ciphertext === "string" &&
    envelope.ciphertext.length >= 23 &&
    envelope.ciphertext.length <= 8000 &&
    /^[A-Za-z0-9_-]+$/u.test(envelope.ciphertext) &&
    typeof envelope.signature === "string" &&
    /^[A-Za-z0-9_-]{86}$/u.test(envelope.signature) &&
    typeof envelope.senderPublicId === "string" &&
    typeof envelope.sessionId === "string" &&
    /^[0-9a-f-]{36}$/iu.test(envelope.sessionId) &&
    typeof envelope.seq === "number" &&
    Number.isInteger(envelope.seq) &&
    envelope.seq >= 0 &&
    envelope.seq < 1_000_000 &&
    typeof envelope.eventType === "string" &&
    typeof envelope.boardGeneration === "number" &&
    Number.isInteger(envelope.boardGeneration) &&
    envelope.boardGeneration >= 0 &&
    Number.isFinite(createdAt) &&
    Math.abs(Date.now() - createdAt) < 5 * 60_000
  );
}

function additionalData(roomId: string, envelope: Omit<CanvasEnvelope, "ciphertext" | "iv" | "signature">) {
  return encoder.encode(
    [
      "pairchat/canvas/v1",
      roomId,
      envelope.sessionId,
      envelope.senderPublicId,
      envelope.eventType,
      String(envelope.seq),
      String(envelope.boardGeneration),
      envelope.id,
      envelope.createdAt,
    ].join("\n"),
  );
}

export function canvasSigningBytes(roomId: string, envelope: Omit<CanvasEnvelope, "signature">) {
  return encoder.encode(
    [
      "pairchat-canvas-envelope-v1",
      roomId,
      envelope.sessionId,
      envelope.eventType,
      String(envelope.seq),
      String(envelope.boardGeneration),
      envelope.id,
      envelope.senderPublicId,
      envelope.createdAt,
      envelope.iv,
      envelope.ciphertext,
    ].join("\n"),
  );
}

export async function encryptCanvasEvent(
  encryption: ConversationEncryption | undefined,
  room: Pick<RoomSnapshot, "id" | "partnerPublicKey">,
  senderPublicId: string,
  sessionId: string,
  seq: number,
  boardGeneration: number,
  event: CanvasPlainEvent,
): Promise<Omit<CanvasEnvelope, "signature">> {
  const key = await getCanvasCryptoKey(encryption, room);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    version: 1 as const,
    id: crypto.randomUUID(),
    senderPublicId,
    createdAt: new Date().toISOString(),
    sessionId,
    seq,
    eventType: event.type,
    boardGeneration,
  };
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: additionalData(room.id, header),
      tagLength: 128,
    },
    key,
    encoder.encode(JSON.stringify(event)),
  );
  return {
    ...header,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptCanvasEvent(
  encryption: ConversationEncryption | undefined,
  room: Pick<RoomSnapshot, "id" | "partnerPublicKey">,
  envelope: CanvasEnvelope,
): Promise<CanvasPlainEvent> {
  const key = await getCanvasCryptoKey(encryption, room);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64Url(envelope.iv),
      additionalData: additionalData(room.id, envelope),
      tagLength: 128,
    },
    key,
    fromBase64Url(envelope.ciphertext),
  );
  const parsed = JSON.parse(decoder.decode(plaintext)) as CanvasPlainEvent;
  if (!parsed || parsed.type !== envelope.eventType) throw new Error("Canvas event type mismatch");
  return parsed;
}

export async function signCanvasEnvelope(
  encryption: ConversationEncryption | undefined,
  roomId: string,
  envelope: Omit<CanvasEnvelope, "signature">,
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
    canvasSigningBytes(roomId, envelope),
  );
  return toBase64Url(new Uint8Array(signature));
}

export async function verifyCanvasEnvelope(
  serializedPublicKey: string | null,
  roomId: string,
  envelope: CanvasEnvelope,
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
      canvasSigningBytes(roomId, envelope),
    );
  } catch {
    return false;
  }
}

export function isCompatibleInvite(event: CanvasPlainEvent) {
  return (
    event.type === "invite" &&
    event.protocol === CANVAS_PROTOCOL &&
    event.width === CANVAS_WIDTH &&
    event.height === CANVAS_HEIGHT &&
    event.units === "normalized"
  );
}
