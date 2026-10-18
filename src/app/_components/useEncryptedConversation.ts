"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { decryptMessage, encryptMessage } from "@/lib/crypto";
import { loadHistory, saveEnvelope } from "@/lib/client-store";
import { validWire, type DisplayMessage, type WireMessage } from "@/lib/protocol";

type Options = { scope: string | null; apiBase: string | null; key: CryptoKey | null; me: { id: string; displayName: string } | null; onControl: (data: Record<string, unknown>) => void; ended?: boolean };

export function useEncryptedConversation({ scope, apiBase, key, me, onControl, ended = false }: Options) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const control = useRef(onControl);
  control.current = onControl;
  const generation = useRef(0);
  const merge = useCallback((m: DisplayMessage) => setMessages(prev => {
    const without = prev.filter(p => p.id !== m.id);
    return [...without, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(-500);
  }), []);

  useEffect(() => {
    const current = ++generation.current;
    setMessages([]); setConnected(false); setError(null);
    if (!scope || !key || !me) return;
    let cancelled = false;
    const seen = new Set<string>();
    const ingest = async (m: WireMessage, historical = false) => {
      if (!validWire(m, scope) || seen.has(m.id)) return;
      const plaintext = await decryptMessage(key, m.body, scope, m.senderUserId);
      if (cancelled || generation.current !== current) return;
      if (plaintext === null) { setError("A message could not be authenticated. It was not displayed."); return; }
      if (seen.has(m.id)) return;
      seen.add(m.id);
      if (!historical) {
        try { await saveEnvelope(m); } catch { setError("Local history could not be saved. Check browser storage."); }
      }
      if (cancelled) return;
      merge({ ...m, body: plaintext });
    };
    void loadHistory(scope).then(async rows => {
      for (const m of rows) { if (cancelled) return; await ingest(m, true); }
    }).catch(() => { if (!cancelled) setError("Local history is unavailable in this browser."); });
    if (!apiBase || ended) return () => { cancelled = true; };
    const stream = new EventSource(apiBase);
    stream.addEventListener("ready", () => { if (!cancelled) setConnected(true); });
    stream.addEventListener("message", ev => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as Record<string, unknown>;
        if (data.type === "message") void ingest(data.message as WireMessage);
        else {
          if (data.type === "room_closed" || data.type === "session_ended") { setConnected(false); stream.close(); }
          control.current(data);
        }
      } catch { /* reject invalid event */ }
    });
    stream.addEventListener("fatal", () => { setConnected(false); stream.close(); setError("Connection is no longer authorized. Reopen the chat."); });
    stream.onerror = () => { if (!cancelled) setConnected(false); };
    return () => { cancelled = true; stream.close(); };
  }, [scope, apiBase, key, me?.id, ended, merge]);

  const send = useCallback(async (plaintext: string) => {
    if (!scope || !apiBase || !key || !me || ended || !connected) throw new Error("Chat is not connected");
    const current = generation.current;
    const envelope = await encryptMessage(key, scope, me.id, plaintext);
    const body = JSON.stringify(envelope);
    const res = await fetch(apiBase, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envelope: body }) });
    if (!res.ok) {
      let reason = "Message was not sent.";
      try { const data = await res.json(); if (typeof data.error === "string") reason = data.error; } catch { /* empty response */ }
      throw new Error(reason);
    }
    const reply = await res.json() as { message: WireMessage };
    if (!validWire(reply.message, scope) || reply.message.body !== body || reply.message.id !== envelope.id) throw new Error("Invalid relay response");
    try { await saveEnvelope(reply.message); } catch { setError("Local history could not be saved. Check browser storage."); }
    if (generation.current === current) merge({ ...reply.message, body: plaintext });
  }, [scope, apiBase, key, me, ended, connected, merge]);
  return { messages, connected, error, send };
}
