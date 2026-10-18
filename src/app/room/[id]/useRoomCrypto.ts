"use client";
import { useEffect, useState } from "react";
import { b64uEncode, deriveRoomKey, parseRoomKey } from "@/lib/crypto";
export const ROOM_KEY_PREFIX = "chatterbox.e2ee.room-key.";

export function readRoomSecret(ref: string): Uint8Array | null {
  const hash = window.location.hash.slice(1);
  // An explicitly invalid hash must not silently fall back to a different key.
  if (hash) { try { return parseRoomKey(decodeURIComponent(hash)); } catch { return null; } }
  try { return parseRoomKey(localStorage.getItem(ROOM_KEY_PREFIX + ref) ?? ""); } catch { return null; }
}
export function useRoomCrypto(roomId: string | null) {
  const [result, setResult] = useState<{ roomId: string; key: CryptoKey; encoded: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    if (!roomId) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = readRoomSecret(roomId);
        if (!raw) throw new Error("The original invite encryption key is required. A replacement key cannot recover this chat.");
        const encoded = b64uEncode(raw);
        const key = await deriveRoomKey(raw, `room:${roomId}`);
        localStorage.setItem(ROOM_KEY_PREFIX + roomId, encoded);
        if (!cancelled) setResult({ roomId, key, encoded });
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Room key unavailable"); }
    })();
    return () => { cancelled = true; };
  }, [roomId]);
  return { key: result?.roomId === roomId ? result.key : null, keyB64: result?.roomId === roomId ? result.encoded : null, error };
}
