export type ClientAdmissionChallenge = {
  version: "v1";
  sessionHash: string;
  nonce: string;
  difficulty: number;
  expiresAt: number;
  signature: string;
};

function hasLeadingZeroBits(digest: Uint8Array, bits: number) {
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

export function isClientAdmissionChallenge(value: unknown): value is ClientAdmissionChallenge {
  if (!value || typeof value !== "object") return false;
  const challenge = value as Partial<ClientAdmissionChallenge>;
  return (
    challenge.version === "v1" &&
    typeof challenge.sessionHash === "string" &&
    typeof challenge.nonce === "string" &&
    typeof challenge.difficulty === "number" &&
    challenge.difficulty >= 12 &&
    challenge.difficulty <= 24 &&
    typeof challenge.expiresAt === "number" &&
    typeof challenge.signature === "string"
  );
}

export async function solveAdmissionChallenge(challenge: ClientAdmissionChallenge) {
  const encoder = new TextEncoder();
  const deadline = Math.min(challenge.expiresAt, Date.now() + 90_000);
  for (let solution = 0; solution < 50_000_000; solution += 1) {
    if (solution % 2_000 === 0 && Date.now() > deadline) break;
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(`${challenge.nonce}:${challenge.sessionHash}:${solution}`),
      ),
    );
    if (hasLeadingZeroBits(digest, challenge.difficulty)) {
      return { ...challenge, solution: String(solution) };
    }
  }
  throw new Error("Admission challenge expired");
}
