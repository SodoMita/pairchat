"use client";
import { useEffect, useState } from "react";
import { b64uDecode, b64uEncode, deriveConversationKey, safetyCode, type IdentityKeypair } from "@/lib/crypto";
import { loadOrCreateIdentityKeypair, pinPartner } from "@/lib/client-store";
import { validPublicKey } from "@/lib/protocol";

export function useStrangerCrypto(sessionId: string | null, userId: string | null, partnerKeyB64: string | null) {
  const storageId = sessionId && userId ? `stranger:${userId}:${sessionId}` : null;
  const [identityState, setIdentityState] = useState<{ storageId: string; identity: IdentityKeypair } | null>(null);
  const [derived, setDerived] = useState<{ storageId: string; peer: string; key: CryptoKey; code: string } | null>(null);
  const [failure, setFailure] = useState<{ storageId: string; message: string } | null>(null);
  const identity = identityState?.storageId === storageId ? identityState.identity : null;
  useEffect(() => {
    if (!storageId || !sessionId) return;
    let cancelled = false;
    setFailure(null);
    void (async () => {
      try {
        const kp = await loadOrCreateIdentityKeypair(storageId);
        if (cancelled) return;
        const res = await fetch("/api/stranger/start", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, identityPubKey: b64uEncode(kp.publicKey) }) });
        if (!res.ok) throw new Error(res.status === 409 ? "This session already has a different encryption key. Start a new chat." : "Could not publish the encryption key. Please reopen the chat.");
        if (!cancelled) setIdentityState({ storageId, identity: kp });
      } catch (e) { if (!cancelled) setFailure({ storageId, message: e instanceof Error ? e.message : "Encryption unavailable" }); }
    })();
    return () => { cancelled = true; };
  }, [storageId, sessionId]);
  useEffect(() => {
    if (!identity || !storageId || !sessionId || !partnerKeyB64) return;
    let cancelled = false;
    void (async () => {
      try {
        if (!validPublicKey(partnerKeyB64)) throw new Error("Invalid partner key");
        await pinPartner(storageId, partnerKeyB64);
        const peer = b64uDecode(partnerKeyB64);
        const scope = `stranger:${sessionId}`;
        const key = await deriveConversationKey(identity, peer, scope);
        const code = await safetyCode(scope, identity.publicKey, peer);
        if (!cancelled) setDerived({ storageId, peer: partnerKeyB64, key, code });
      } catch (e) { if (!cancelled) setFailure({ storageId, message: e instanceof Error ? e.message : "Key verification failed" }); }
    })();
    return () => { cancelled = true; };
  }, [identity, storageId, sessionId, partnerKeyB64]);
  const valid = derived?.storageId === storageId && derived?.peer === partnerKeyB64;
  const error = failure?.storageId === storageId ? failure.message : null;
  return { key: valid && !error ? derived!.key : null, code: valid ? derived!.code : null, error };
}
