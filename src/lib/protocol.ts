// Shared, dependency-free wire validation. Never log envelopes or plaintext.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SID_RE = /^[A-Za-z0-9_-]{21}$/;
export const MAX_TEXT = 2000;
export const MAX_ENVELOPE_BYTES = 11_500;
export const validScope = (s: string) => s.startsWith("room:") ? UUID_RE.test(s.slice(5)) : s.startsWith("stranger:") && SID_RE.test(s.slice(9));
export const encode64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export function decode64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), c => c.charCodeAt(0));
  if (encode64(bytes) !== value) throw new Error("Noncanonical base64url");
  return bytes;
}
export function validPublicKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 43) return false;
  try { const raw = decode64(value); return raw.length === 32 && raw.some(b => b !== 0); } catch { return false; }
}

export type Envelope = {
  v: 2;
  id: string;
  scope: string;
  sender: string;
  createdAt: string;
  iv: string;
  ct: string;
};
export function parseEnvelope(value: string): Envelope | null {
  if (value.length > MAX_ENVELOPE_BYTES) return null;
  try {
    const e = JSON.parse(value) as Envelope;
    if (!e || typeof e !== "object" || Array.isArray(e) || Object.keys(e).sort().join(",") !== "createdAt,ct,id,iv,scope,sender,v") return null;
    if (e.v !== 2 || !UUID_RE.test(e.id) || !UUID_RE.test(e.sender) || typeof e.scope !== "string" || !validScope(e.scope)) return null;
    if (typeof e.createdAt !== "string" || new Date(e.createdAt).toISOString() !== e.createdAt) return null;
    if (typeof e.iv !== "string" || e.iv.length !== 16 || decode64(e.iv).length !== 12) return null;
    if (typeof e.ct !== "string" || e.ct.length > 10_688) return null;
    const size = decode64(e.ct).length;
    if (size < 17 || size > 8016) return null;
    return e;
  } catch { return null; }
}
export function authenticatedData(e: Pick<Envelope, "v" | "scope" | "sender" | "id" | "createdAt">): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(["chatterbox/text", e.v, e.scope, e.sender, e.id, e.createdAt]));
}
export type WireMessage = { id: string; scope: string; senderUserId: string; senderName: string; body: string; createdAt: string; systemFlag: false };
export type DisplayMessage = Omit<WireMessage, "systemFlag"> & { systemFlag: boolean };
export function validWire(m: WireMessage, scope: string): boolean {
  if (!m || m.scope !== scope || m.systemFlag !== false || typeof m.body !== "string") return false;
  const e = parseEnvelope(m.body);
  return !!e && e.id === m.id && e.sender === m.senderUserId && e.scope === scope && e.createdAt === m.createdAt;
}
