import type { EncryptedMessageEnvelope } from "@/lib/chat-events";
import { envelopeSigningBytes } from "@/lib/e2ee";

export async function verifyParticipantSignature(
  serializedPublicKey: string | null,
  signedBytes: Uint8Array,
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
    const signature = Buffer.from(signatureValue, "base64url");
    if (signature.byteLength !== 64) return false;
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signature,
      Buffer.from(signedBytes),
    );
  } catch {
    return false;
  }
}

export async function verifyServerEnvelopeSignature(
  serializedPublicKey: string | null,
  roomId: string,
  envelope: EncryptedMessageEnvelope,
) {
  return verifyParticipantSignature(
    serializedPublicKey,
    envelopeSigningBytes(roomId, envelope),
    envelope.signature,
  );
}
