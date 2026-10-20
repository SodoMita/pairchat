const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type WireChannelEvent = {
  seq: number;
  ts: string;
  src: string;
  nonce: string;
  ct: string;
};

export type DecryptedChannelMessage = {
  id: number;
  ts: string;
  src: string;
  from: string;
  text: string;
  status: "ok" | "undecryptable" | "invalid";
};

export type RenderedChannelRow = {
  id: number;
  ts: string;
  src: string;
  from: string;
  text: string;
  status: "ok" | "undecryptable" | "invalid";
  kind: "message" | "reply" | "join" | "system";
  replyTo?: { id: number; from: string; preview: string };
  reactions: { token: string; senders: string[] }[];
};

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

export function isValidChannelId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{22}$/u.test(value);
}

export function isValidChannelKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) return false;
  try {
    return fromBase64Url(value).byteLength === 32;
  } catch {
    return false;
  }
}

export function generateChannelKey(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function randomCallsign(): string {
  const words = [
    "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel",
    "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa",
    "Quebec", "Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "Xray", "Yankee", "Zulu",
  ];
  const pick = crypto.getRandomValues(new Uint8Array(2));
  const word = words[pick[0] % words.length];
  const num = String(pick[1] % 100).padStart(2, "0");
  return `${word}${num}`;
}

export type DerivedChannelCredentials = {
  key: string;
  id: string;
  auth: string;
  authHash: string;
  encKey: CryptoKey;
};

export async function deriveChannelCredentials(keyB64: string): Promise<DerivedChannelCredentials> {
  if (!isValidChannelKey(keyB64)) {
    throw new Error("Invalid 32-byte channel key.");
  }
  const rawKey = fromBase64Url(keyB64);
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    rawKey as BufferSource,
    "HKDF",
    false,
    ["deriveBits", "deriveKey"],
  );
  const emptySalt = new Uint8Array(0);
  const [idBits, authBits, encKey] = await Promise.all([
    crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: emptySalt, info: encoder.encode("mayfly id") },
      hkdfKey,
      128,
    ),
    crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: emptySalt, info: encoder.encode("mayfly auth") },
      hkdfKey,
      256,
    ),
    crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: emptySalt, info: encoder.encode("mayfly enc") },
      hkdfKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    ),
  ]);

  const id = toBase64Url(new Uint8Array(idBits));
  const auth = toBase64Url(new Uint8Array(authBits));
  const authDigest = await crypto.subtle.digest("SHA-256", encoder.encode(auth));
  const authHash = toBase64Url(new Uint8Array(authDigest));

  return { key: keyB64, id, auth, authHash, encKey };
}

export function sanitizeSenderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || /[\x00-\x1f\x7f]/u.test(trimmed)) {
    throw new Error("Sender name must be non-empty and free of control characters.");
  }
  return trimmed;
}

export async function sealChannelMessage(
  encKey: CryptoKey,
  channelId: string,
  seq: number,
  from: string,
  text: string,
): Promise<{ nonce: string; ct: string }> {
  const cleanFrom = sanitizeSenderName(from);
  if (!text || !text.trim()) {
    throw new Error("Message text must be non-blank.");
  }
  const inner = encoder.encode(JSON.stringify({ from: cleanFrom, text }));
  const remainder = inner.byteLength % 256;
  const paddedLength = remainder === 0 ? inner.byteLength : inner.byteLength + (256 - remainder);
  const padded = new Uint8Array(paddedLength);
  padded.fill(0x20);
  padded.set(inner, 0);

  const nonceBytes = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonceBytes,
      additionalData: encoder.encode(`${channelId}:${seq}`),
      tagLength: 128,
    },
    encKey,
    padded,
  );

  return {
    nonce: toBase64Url(nonceBytes),
    ct: toBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function openChannelEvent(
  encKey: CryptoKey,
  channelId: string,
  event: WireChannelEvent,
): Promise<DecryptedChannelMessage> {
  let plaintext: ArrayBuffer;
  try {
    const nonceBytes = fromBase64Url(event.nonce);
    const ctBytes = fromBase64Url(event.ct);
    if (nonceBytes.byteLength !== 12 || ctBytes.byteLength < 16) {
      throw new Error("Bad envelope size");
    }
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonceBytes as BufferSource,
        additionalData: encoder.encode(`${channelId}:${event.seq}`),
        tagLength: 128,
      },
      encKey,
      ctBytes as BufferSource,
    );
  } catch {
    return {
      id: event.seq,
      ts: event.ts,
      src: event.src,
      from: "",
      text: "(undecryptable message)",
      status: "undecryptable",
    };
  }

  try {
    const parsed = JSON.parse(decoder.decode(plaintext)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Not an object");
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.from !== "string" ||
      !record.from.trim() ||
      /[\x00-\x1f\x7f]/u.test(record.from) ||
      typeof record.text !== "string" ||
      !record.text.trim()
    ) {
      throw new Error("Invalid inner fields");
    }
    return {
      id: event.seq,
      ts: event.ts,
      src: event.src,
      from: record.from.trim(),
      text: record.text,
      status: "ok",
    };
  } catch {
    return {
      id: event.seq,
      ts: event.ts,
      src: event.src,
      from: "",
      text: "(invalid message)",
      status: "invalid",
    };
  }
}

/**
 * Apply strict Mayfly view conventions (/title, /react, /unreact, /re, /join)
 * strictly at render time in the browser without mutating stored messages.
 */
export function foldChannelView(messages: DecryptedChannelMessage[]): {
  title: string;
  rows: RenderedChannelRow[];
} {
  let title = "";
  const rows: RenderedChannelRow[] = [];
  const visibleById = new Map<number, RenderedChannelRow>();
  const reactionSets = new Map<number, Map<string, Set<string>>>();

  for (const msg of messages) {
    if (msg.status !== "ok") {
      const placeholder: RenderedChannelRow = {
        ...msg,
        kind: "system",
        reactions: [],
      };
      rows.push(placeholder);
      visibleById.set(msg.id, placeholder);
      continue;
    }

    const trimmed = msg.text.trim();

    if (trimmed === "/title") {
      title = "";
      continue;
    }
    if (trimmed.startsWith("/title ")) {
      const rest = trimmed.slice(7);
      if (rest.length > 0 && !/[\r\n\x00-\x1f\x7f]/u.test(rest)) {
        title = rest;
        continue;
      }
    }

    const reactMatch = /^\/(react|unreact) (0|[1-9][0-9]*) ([^\s\x00-\x1f\x7f]+)$/u.exec(trimmed);
    if (reactMatch) {
      const targetId = Number(reactMatch[2]);
      const token = reactMatch[3];
      if (visibleById.has(targetId)) {
        let tokenMap = reactionSets.get(targetId);
        if (!tokenMap) {
          tokenMap = new Map();
          reactionSets.set(targetId, tokenMap);
        }
        let senders = tokenMap.get(token);
        if (!senders) {
          senders = new Set();
          tokenMap.set(token, senders);
        }
        if (reactMatch[1] === "react") senders.add(msg.from);
        else senders.delete(msg.from);
        continue;
      }
    }

    const joinMatch = /^\/join (.+)$/u.exec(trimmed);
    if (joinMatch && joinMatch[1] === msg.from) {
      const row: RenderedChannelRow = {
        ...msg,
        kind: "join",
        reactions: [],
      };
      rows.push(row);
      visibleById.set(msg.id, row);
      continue;
    }

    const replyMatch = /^\/re (0|[1-9][0-9]*) ([\s\S]+)$/u.exec(trimmed);
    if (replyMatch && replyMatch[2].trim()) {
      const targetId = Number(replyMatch[1]);
      const parent = visibleById.get(targetId);
      if (parent) {
        const row: RenderedChannelRow = {
          ...msg,
          text: replyMatch[2],
          kind: "reply",
          replyTo: {
            id: parent.id,
            from: parent.from || "system",
            preview: parent.text.replace(/\s+/gu, " ").slice(0, 90),
          },
          reactions: [],
        };
        rows.push(row);
        visibleById.set(msg.id, row);
        continue;
      }
    }

    const row: RenderedChannelRow = {
      ...msg,
      kind: "message",
      reactions: [],
    };
    rows.push(row);
    visibleById.set(msg.id, row);
  }

  for (const [targetId, tokenMap] of reactionSets) {
    const row = visibleById.get(targetId);
    if (!row) continue;
    row.reactions = Array.from(tokenMap.entries())
      .filter(([, senders]) => senders.size > 0)
      .map(([token, senders]) => ({ token, senders: Array.from(senders) }));
  }

  return { title, rows };
}
