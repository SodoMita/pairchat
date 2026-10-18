export type RoomKind = "random" | "private";
export type RoomStatus = "waiting" | "active" | "ended";

export type RoomSnapshot = {
  id: string;
  kind: RoomKind;
  status: RoomStatus;
  partnerPresent: boolean;
  partnerOnline: boolean;
  participantPublicId: string;
  partnerPublicId: string | null;
  partnerPublicKey: string | null;
  partnerSigningKey: string | null;
  participantActive: boolean;
  createdAt: string;
};

export function createRoomId(kind: RoomKind) {
  const prefix = kind === "private" ? "p" : "r";
  const token = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${prefix}_${token}`;
}

export function isValidClientId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 100 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

export function isValidParticipantPublicId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

export function isValidAbuseSession(value: unknown): value is string {
  return typeof value === "string" && /^as_[A-Za-z0-9_-]{43}$/u.test(value);
}

export function isValidRoomId(value: unknown): value is string {
  return typeof value === "string" && /^[rp]_[a-f0-9]{32}$/u.test(value);
}

export function isValidPrivateCommitment(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function isValidEcdhPublicKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 100 || value.length > 500) return false;
  try {
    const key = JSON.parse(value) as JsonWebKey;
    return (
      key.kty === "EC" &&
      key.crv === "P-256" &&
      typeof key.x === "string" &&
      /^[A-Za-z0-9_-]{43}$/u.test(key.x) &&
      typeof key.y === "string" &&
      /^[A-Za-z0-9_-]{43}$/u.test(key.y) &&
      !key.d
    );
  } catch {
    return false;
  }
}

export function isValidEcdsaPublicKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 100 || value.length > 600) return false;
  try {
    const key = JSON.parse(value) as JsonWebKey;
    return (
      key.kty === "EC" &&
      key.crv === "P-256" &&
      (key.alg === undefined || key.alg === "ES256") &&
      typeof key.x === "string" &&
      /^[A-Za-z0-9_-]{43}$/u.test(key.x) &&
      typeof key.y === "string" &&
      /^[A-Za-z0-9_-]{43}$/u.test(key.y) &&
      !key.d
    );
  } catch {
    return false;
  }
}
