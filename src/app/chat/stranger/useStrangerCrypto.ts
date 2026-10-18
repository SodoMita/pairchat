"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  b64uDecode,
  b64uEncode,
  loadOrCreateIdentityKeypair,
  openStrangerMessage,
  parseEnvelope,
  sealStrangerMessage,
  type IdentityKeypair,
} from "@/lib/crypto";

const PUBLISH_RETRY_MS = [0, 1500, 4000];

/**
 * Per-chat X25519 identity for the stranger flow.
 *
 * - Loads (or creates) this browser's non-extractable identity keypair for
 *   (user, session) and publishes the PUBLIC half to the server, which
 *   pushes it to the partner.
 * - The partner's public key is an input (`partnerKeyB64`), delivered over
 *   the `/api/stranger/events` stream — this hook does no polling.
 */
export function useStrangerCrypto(
  sessionId: string | null,
  userId: string | null,
  partnerKeyB64: string | null,
) {
  const [identity, setIdentity] = useState<IdentityKeypair | null>(null);
  const identityRef = useRef<IdentityKeypair | null>(null);
  identityRef.current = identity;

  useEffect(() => {
    setIdentity(null);
    if (!sessionId || !userId) return;
    let cancelled = false;
    (async () => {
      const kp = await loadOrCreateIdentityKeypair(
        `stranger:${userId}:${sessionId}`,
      );
      if (cancelled) return;
      setIdentity(kp);
      const body = JSON.stringify({ identityPubKey: b64uEncode(kp.publicKey) });
      // Publishing is idempotent; retry a couple of times on failure.
      for (const delay of PUBLISH_RETRY_MS) {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (cancelled) return;
        try {
          const res = await fetch("/api/stranger/start", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body,
          });
          if (res.ok) return;
        } catch {
          /* retry */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, userId]);

  const partnerKey = useMemo(() => {
    if (!partnerKeyB64) return null;
    try {
      const raw = b64uDecode(partnerKeyB64);
      return raw.length === 32 ? raw : null;
    } catch {
      return null;
    }
  }, [partnerKeyB64]);

  const encrypt = useCallback(
    async (plaintext: string) => {
      const me = identityRef.current;
      if (!me || !partnerKey) throw new Error("Crypto not ready");
      const sealed = await sealStrangerMessage(plaintext, me.privateKey, partnerKey);
      return {
        envelope: JSON.stringify(sealed.envelope),
        ephemeralPubKey: b64uEncode(sealed.ephemeralPub),
      };
    },
    [partnerKey],
  );

  const decrypt = useCallback(
    async (
      envelopeJson: string,
      senderStaticPub: Uint8Array,
      senderEphemeralPubB64: string,
    ) => {
      const me = identityRef.current;
      if (!me) return null;
      const env = parseEnvelope(envelopeJson);
      if (!env) return null;
      try {
        return await openStrangerMessage(
          env,
          me.privateKey,
          senderStaticPub,
          b64uDecode(senderEphemeralPubB64),
        );
      } catch {
        return null;
      }
    },
    [],
  );

  return useMemo(
    () => ({ identity, partnerKey, partnerKeyReady: !!partnerKey, encrypt, decrypt }),
    [identity, partnerKey, encrypt, decrypt],
  );
}
