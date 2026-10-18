"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  generateRoomKey,
  openRoomMessage,
  parseEnvelope,
  parseRoomKey,
  sealRoomMessage,
} from "@/lib/crypto";

const ROOM_KEY_PREFIX = "chatterbox.e2ee.room-key.";

/**
 * Manages a room's AES-256-GCM key. Shareable keys live in the URL
 * fragment, which browsers never send in HTTP requests. A local copy is
 * kept in localStorage so this browser can rejoin from chat history.
 *
 * Guests with a missing key are never given a fresh, unrelated key:
 * they see a clear missing-key state instead. Only the host may create
 * the initial key.
 */
export function useRoomCrypto(roomId: string | null, canGenerate: boolean) {
  const [ready, setReady] = useState(false);
  const [keyMissing, setKeyMissing] = useState(false);
  const [keyB64, setKeyB64] = useState<string | null>(null);
  const keyRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    setReady(false);
    setKeyMissing(false);
    keyRef.current = null;
    // The room id and our role are only known after POST /enter.
    if (!roomId) return;

    const localKeyName = `${ROOM_KEY_PREFIX}${roomId}`;
    const loadKey = async () => {
      let raw: Uint8Array | null = null;
      const hash = window.location.hash.replace(/^#/, "");
      if (hash) {
        try {
          raw = parseRoomKey(decodeURIComponent(hash));
        } catch {
          raw = null;
        }
      }

      // Restore a previously opened room from this browser if the URL
      // fragment was lost (e.g. re-opening from history).
      if (!raw) {
        try {
          const stored = window.localStorage.getItem(localKeyName);
          if (stored) raw = parseRoomKey(stored);
        } catch {
          /* storage unavailable */
        }
      }

      if (!raw && canGenerate) {
        const generated = generateRoomKey();
        raw = generated.key;
        try {
          window.localStorage.setItem(localKeyName, generated.encoded);
        } catch {
          /* storage may be disabled; URL fragment remains the fallback */
        }
      }

      if (!raw) {
        if (!cancelled) setKeyMissing(true);
        return;
      }

      const encoded = b64uEncode(raw);
      try {
        window.localStorage.setItem(localKeyName, encoded);
      } catch {
        /* ignore */
      }
      // Ensure this browser's current URL is copyable with its key.
      if (window.location.hash !== `#${encoded}`) {
        try {
          history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}#${encoded}`,
          );
        } catch {
          /* ignore */
        }
      }
      if (cancelled) return;
      keyRef.current = raw;
      setKeyB64(encoded);
      setReady(true);
    };

    void loadKey();
    return () => {
      cancelled = true;
    };
  }, [roomId, canGenerate]);

  const encrypt = useCallback(async (plaintext: string) => {
    const key = keyRef.current;
    if (!key) throw new Error("Room key not ready");
    const envelope = await sealRoomMessage(plaintext, key);
    return JSON.stringify(envelope);
  }, []);
  const decrypt = useCallback(async (envelopeJson: string) => {
    const key = keyRef.current;
    if (!key) return null;
    const envelope = parseEnvelope(envelopeJson);
    if (!envelope) return null;
    return openRoomMessage(envelope, key);
  }, []);

  return useMemo(
    () => ({ ready, keyMissing, keyB64, encrypt, decrypt }),
    [ready, keyMissing, keyB64, encrypt, decrypt],
  );
}

function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  const b64 = btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}