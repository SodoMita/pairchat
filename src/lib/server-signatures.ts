import type { EncryptedMessageEnvelope } from "@/lib/chat-events";
import { envelopeSigningBytes } from "@/lib/e2ee";

export async function verifyServerEnvelopeSignature(
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
    const signature = Buffer.from(envelope.signature, "base64url");
    if (signature.byteLength !== 64) return false;
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signature,
      envelopeSigningBytes(roomId, envelope),
    );
  } catch {
    return false;
  }
}
