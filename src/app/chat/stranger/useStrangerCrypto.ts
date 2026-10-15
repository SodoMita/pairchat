"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  b64uEncode,
  loadOrCreateIdentityKeypair,
  openStrangerMessage,
  parseEnvelope,
  sealStrangerMessage,
  type IdentityKeypair,
} from "@/lib/crypto";

/**
 * Manages the X25519 identity keypair for the current tab and the
 * partner's public key. Publishes the public half to the server so
 * the partner can fetch it, and decrypts received envelopes on the
 * fly.
 *
 * Returns:
 *   - `identity`: my keypair (private non-extractable)
 *   - `partnerKey`: partner's static public key (Uint8Array) once known
 *   - `partnerKeyReady`: boolean — true once partner has published
 *   - `encrypt(plaintext)`: returns the envelope + ephemeral public
 *     key bytes (base64url) ready to send to the server.
 *   - `decrypt(envelope, senderStaticPub, senderEphemeralPub)`:
 *     returns plaintext or null on auth failure.
 */
export function useStrangerCrypto(
  sessionId: string | null,
  userId: string | null,
) {
  const [identity, setIdentity] = useState<IdentityKeypair | null>(null);
  const [partnerKey, setPartnerKey] = useState<Uint8Array | null>(null);
  const [partnerKeyReady, setPartnerKeyReady] = useState(false);
  const identityRef = useRef<IdentityKeypair | null>(null);
  identityRef.current = identity;

  // Generate identity keypair on mount and publish the public half to
  // the server. The private key stays in this browser tab.
  useEffect(() => {
    setIdentity(null);
    setPartnerKey(null);
    setPartnerKeyReady(false);
    if (!sessionId || !userId) return;
    let cancelled = false;
    (async () => {
      const kp = await loadOrCreateIdentityKeypair(`stranger:${userId}:${sessionId}`);
      if (cancelled) return;
      setIdentity(kp);
      const pubB64 = b64uEncode(kp.publicKey);
      try {
        await fetch("/api/stranger/start", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identityPubKey: pubB64 }),
        });
      } catch {
        // best-effort; partner will still eventually be able to read
        // messages once they PATCH too.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, userId]);

  // Poll the partner's static public key. Stops once known.
  useEffect(() => {
    if (!sessionId || partnerKeyReady) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch("/api/stranger/partner-key", {
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as {
            ready?: boolean;
            identityPubKey?: string;
          };
          if (data.ready && data.identityPubKey) {
            if (!cancelled) {
              setPartnerKey(b64uDecodeSafe(data.identityPubKey));
              setPartnerKeyReady(true);
            }
            return;
          }
        }
      } catch {
        // ignore
      }
      timer = setTimeout(tick, 1500);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, partnerKeyReady]);

  // When the user navigates away (closes the tab), delete the queue
  // row so the partner sees them as gone.
  useEffect(() => {
    if (!sessionId) return;
    function cleanup() {
      navigator.sendBeacon?.(
        "/api/stranger/start",
        new Blob([JSON.stringify({})], { type: "application/json" }),
      );
    }
    window.addEventListener("beforeunload", cleanup);
    return () => window.removeEventListener("beforeunload", cleanup);
  }, [sessionId]);

  const encrypt = useCallback(
    async (plaintext: string) => {
      const me = identityRef.current;
      const partner = partnerKey;
      if (!me || !partner) throw new Error("Crypto not ready");
      const sealed = await sealStrangerMessage(plaintext, me.privateKey, partner);
      return {
        envelope: JSON.stringify(sealed.envelope),
        ephemeralPubKey: b64uEncode(sealed.ephemeralPub!),
      };
    },
    [partnerKey],
  );

  const decrypt = useCallback(
    async (
      envelopeJson: string,
      senderStaticPubB64: string,
      senderEphemeralPubB64: string,
    ) => {
      const me = identityRef.current;
      if (!me) return null;
      const env = parseEnvelope(envelopeJson);
      if (!env) return null;
      return openStrangerMessage(
        env,
        me.privateKey,
        b64uDecodeSafe(senderStaticPubB64),
        b64uDecodeSafe(senderEphemeralPubB64),
      );
    },
    [],
  );

  return useMemo(
    () => ({ identity, partnerKey, partnerKeyReady, encrypt, decrypt }),
    [identity, partnerKey, partnerKeyReady, encrypt, decrypt],
  );
}

function b64uDecodeSafe(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(s.length / 4) * 4,
    "=",
  );
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}