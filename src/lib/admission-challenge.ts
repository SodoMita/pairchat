import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const CHALLENGE_VERSION = "v1" as const;
const CHALLENGE_TTL_MS = 2 * 60_000;

type ChallengeRegistry = Map<string, number>;

const globalForChallenges = globalThis as typeof globalThis & {
  __lumaChallengeSecret?: string;
  __lumaUsedChallenges?: ChallengeRegistry;
};

const challengeSecret =
  globalForChallenges.__lumaChallengeSecret ??
  process.env.ADMISSION_CHALLENGE_SECRET ??
  randomBytes(32).toString("hex");
globalForChallenges.__lumaChallengeSecret = challengeSecret;

const usedChallenges =
  globalForChallenges.__lumaUsedChallenges ?? new Map<string, number>();
globalForChallenges.__lumaUsedChallenges = usedChallenges;

export type AdmissionChallenge = {
  version: typeof CHALLENGE_VERSION;
  sessionHash: string;
  nonce: string;
  difficulty: number;
  expiresAt: number;
  signature: string;
};

function signChallenge(parts: Omit<AdmissionChallenge, "signature">) {
  return createHmac("sha256", challengeSecret)
    .update(
      [parts.version, parts.sessionHash, parts.nonce, parts.difficulty, parts.expiresAt].join("\n"),
    )
    .digest("hex");
}

export function issueAdmissionChallenge(sessionHash: string, difficulty = 12): AdmissionChallenge {
  const parts: Omit<AdmissionChallenge, "signature"> = {
    version: CHALLENGE_VERSION,
    sessionHash,
    nonce: randomBytes(16).toString("hex"),
    difficulty,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  };
  return { ...parts, signature: signChallenge(parts) };
}

function hasLeadingZeroBits(digest: Buffer, bits: number) {
  let remaining = bits;
  for (const byte of digest) {
    if (remaining >= 8) {
      if (byte !== 0) return false;
      remaining -= 8;
      continue;
    }
    if (remaining === 0) return true;
    return byte >> (8 - remaining) === 0;
  }
  return remaining <= 0;
}

export function verifyAdmissionChallenge(
  value: unknown,
  sessionHash: string,
): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AdmissionChallenge> & { solution?: unknown };
  if (
    candidate.version !== CHALLENGE_VERSION ||
    candidate.sessionHash !== sessionHash ||
    typeof candidate.nonce !== "string" ||
    !/^[a-f0-9]{32}$/u.test(candidate.nonce) ||
    typeof candidate.difficulty !== "number" ||
    candidate.difficulty < 12 ||
    candidate.difficulty > 24 ||
    typeof candidate.expiresAt !== "number" ||
    candidate.expiresAt < Date.now() ||
    typeof candidate.signature !== "string" ||
    !/^[a-f0-9]{64}$/u.test(candidate.signature) ||
    typeof candidate.solution !== "string" ||
    !/^[0-9]{1,12}$/u.test(candidate.solution)
  ) {
    return false;
  }

  const expected = signChallenge({
    version: candidate.version,
    sessionHash: candidate.sessionHash,
    nonce: candidate.nonce,
    difficulty: candidate.difficulty,
    expiresAt: candidate.expiresAt,
  });
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(candidate.signature, "hex"))) {
    return false;
  }

  const now = Date.now();
  for (const [nonce, expiry] of usedChallenges) {
    if (expiry <= now) usedChallenges.delete(nonce);
  }
  if (usedChallenges.has(candidate.nonce)) return false;

  const digest = createHash("sha256")
    .update(`${candidate.nonce}:${candidate.sessionHash}:${candidate.solution}`)
    .digest();
  if (!hasLeadingZeroBits(digest, candidate.difficulty)) return false;

  usedChallenges.set(candidate.nonce, candidate.expiresAt);
  return true;
}
