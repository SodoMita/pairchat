import "server-only";
import { createPublicKey, diffieHellman, generateKeyPairSync, type KeyObject } from "node:crypto";
import { validPublicKey } from "@/lib/protocol";
const globalProbe = globalThis as typeof globalThis & { __cbValidationKey?: KeyObject };
// Unrelated throwaway validation key. It is never a participant identity/key.
const privateKey = globalProbe.__cbValidationKey ??= generateKeyPairSync("x25519").privateKey;
const prefix = Buffer.from("302a300506032b656e032100", "hex");
export function usablePublicKey(encoded: unknown): encoded is string {
  if (!validPublicKey(encoded)) return false;
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([prefix, Buffer.from(encoded, "base64url")]), type: "spki", format: "der" });
    const shared = diffieHellman({ privateKey, publicKey });
    const valid = shared.some(byte => byte !== 0);
    shared.fill(0);
    return valid;
  } catch { return false; }
}
