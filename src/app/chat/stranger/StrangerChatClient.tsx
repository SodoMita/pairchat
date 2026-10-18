"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatWindow } from "@/app/_components/ChatWindow";
import { ChatShell } from "@/app/_components/ChatShell";
import { EncryptionInfo } from "@/app/_components/EncryptionInfo";
import { useEncryptedConversation } from "@/app/_components/useEncryptedConversation";
import { useI18n } from "@/app/_components/I18nProvider";
import { rememberRoom, touchRoom } from "@/app/local/_lib/rememberRooms";
import { SID_RE } from "@/lib/protocol";
import { useStrangerCrypto } from "./useStrangerCrypto";
type Me = { id: string; displayName: string };
type Session = { sessionId: string; partnerName: string | null };

export function StrangerChatClient() {
  const router = useRouter();
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const currentSession = useRef<string | null>(null);
  const [partnerKey, setPartnerKey] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [netError, setNetError] = useState(false);
  const [switching, setSwitching] = useState(false);
  const crypto = useStrangerCrypto(session?.sessionId ?? null, me?.id ?? null, partnerKey);
  const scope = session ? `stranger:${session.sessionId}` : null;
  const conversation = useEncryptedConversation({ scope, apiBase: session ? `/api/stranger/messages/${session.sessionId}` : null, key: crypto.key, me, ended, onControl: data => { if (data.type === "session_ended") setEnded(true); } });

  useEffect(() => {
    let stopped = false;
    let stream: EventSource | null = null;
    currentSession.current = null;
    setSession(null); setPartnerKey(null); setEnded(false); setNetError(false); setSwitching(false);
    const paired = (p: Record<string, unknown>) => {
      if (stopped || typeof p.sessionId !== "string" || !SID_RE.test(p.sessionId)) return;
      if (currentSession.current && currentSession.current !== p.sessionId) return; // stale/mismatched tab event
      currentSession.current = p.sessionId;
      setSession(previous => previous?.sessionId === p.sessionId ? previous : { sessionId: p.sessionId as string, partnerName: typeof p.partnerName === "string" ? p.partnerName : null });
      if (p.partnerLeft) setEnded(true);
      if (typeof p.partnerKey === "string") setPartnerKey(p.partnerKey);
    };
    void (async () => {
      try {
        // Serializing browser bootstrap avoids two cold tabs issuing different
        // cookies simultaneously. No extra identity fetch or polling.
        const start = () => fetch("/api/stranger/start", { method: "POST" });
        const response = navigator.locks ? await navigator.locks.request("chatterbox-entry", start) : await start();
        if (!response.ok) throw new Error("Start failed");
        const data = await response.json();
        if (stopped) return;
        setMe(data.me);
        if (data.state === "paired") paired(data);
        stream = new EventSource("/api/stranger/events");
        const handle = (event: MessageEvent) => {
          if (stopped) return;
          try {
            const value = JSON.parse(event.data);
            if (event.type === "state" && value.state === "paired" || event.type === "paired") paired(value);
            else if (value.sessionId === currentSession.current) {
              if (event.type === "partner_key" && typeof value.key === "string") setPartnerKey(value.key);
              if (event.type === "partner_left") setEnded(true);
            }
          } catch { /* malformed event */ }
        };
        for (const type of ["state", "paired", "partner_key", "partner_left"]) stream.addEventListener(type, handle as EventListener);
        stream.addEventListener("fatal", () => { stream?.close(); if (!stopped) setNetError(true); });
      } catch { if (!stopped) setNetError(true); }
    })();
    return () => { stopped = true; stream?.close(); };
  }, [attempt]);

  useEffect(() => {
    if (scope) {
      rememberRoom({ id: scope, kind: "stranger", title: session?.partnerName ?? t("chatTitleDefault"), active: !ended, ownerId: me?.id });
      if (ended) touchRoom(scope, { active: false });
    }
  }, [scope, session?.partnerName, ended, me?.id, t]);

  const leave = useCallback(() => {
    const id = currentSession.current;
    if (id) touchRoom(`stranger:${id}`, { active: false });
    void fetch("/api/stranger/start", { method: "DELETE", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { sessionId: id } : {}) }).catch(() => {});
    router.push("/");
  }, [router]);
  const next = useCallback(async () => {
    if (switching) return;
    setSwitching(true);
    const id = currentSession.current;
    try {
      const res = await fetch("/api/stranger/start", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { sessionId: id } : {}) });
      if (!res.ok) throw new Error("Leave failed");
      if (id) touchRoom(`stranger:${id}`, { active: false });
      setAttempt(n => n + 1);
    } catch { setSwitching(false); setNetError(true); }
  }, [switching]);

  const error = crypto.error || conversation.error;
  const waiting = !session || !me;
  return <ChatShell activeId={scope}>
    {error && <p role="alert" className="border-b border-amber-700 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{error}</p>}
    {waiting || (!crypto.key && !ended) || netError ? <main className="grid min-h-0 flex-1 place-items-center p-6 text-center">
      <section className="max-w-md">
        <h1 className="text-3xl font-bold">{t(netError ? "serviceUnavailable" : waiting ? "searchingTitle" : "cryptoHandshakeTitle")}</h1>
        <p className="mt-3 text-sm text-slate-400">{waiting ? t("searchingBody") : "Encryption keys are being checked in your browser. No plaintext is sent."}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {(netError || error) && <button className="rounded-lg bg-indigo-500 px-4 py-2" onClick={() => void next()}>{t("nextBtn")}</button>}
          <button className="rounded-lg border border-slate-700 px-4 py-2" onClick={leave}>{t("leaveBtn")}</button>
        </div>
      </section>
    </main> : <ChatWindow key={session!.sessionId} initialMessages={[]} externalMessages={conversation.messages} manageSSE={false}
      selfUserId={me!.id} selfName={me!.displayName} apiBase={`/api/stranger/messages/${session!.sessionId}`} historyId={scope!}
      title={session!.partnerName ? t("chatTitleWith", { name: session!.partnerName }) : t("chatTitleDefault")}
      subtitle={t("chatSubtitle")} status={{ kind: ended ? "warn" : conversation.connected ? "ok" : "warn", text: t(ended ? "statusPartnerLeft" : conversation.connected ? "statusConnected" : "loading") }}
      onNext={next} onLeave={leave} disabled={ended || switching || !conversation.connected || !!crypto.error} customSend={conversation.send} encrypted={!!crypto.key} headerRight={<EncryptionInfo code={crypto.code} />} />}
  </ChatShell>;
}
