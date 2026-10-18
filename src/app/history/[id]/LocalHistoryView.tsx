"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChatShell } from "@/app/_components/ChatShell";
import { ChatWindow } from "@/app/_components/ChatWindow";
import { useI18n } from "@/app/_components/I18nProvider";
import { listRememberedRooms, type RememberedRoom } from "@/app/local/_lib/rememberRooms";
import { loadHistory, loadIdentity, loadPartnerPin } from "@/lib/client-store";
import { b64uDecode, decryptMessage, deriveConversationKey, deriveRoomKey, parseRoomKey } from "@/lib/crypto";
import { validScope, type DisplayMessage } from "@/lib/protocol";

/** Read-only archive: deliberately no API requests or queue entry. */
export function LocalHistoryView() {
  const { id: routeId } = useParams<{ id: string }>();
  let id = routeId;
  try { id = decodeURIComponent(routeId); } catch { /* rejected by validScope */ }
  const { t } = useI18n();
  const router = useRouter();
  const [state, setState] = useState<{ entry: RememberedRoom; messages: DisplayMessage[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setState(null); setError(false);
    void (async () => {
      try {
        if (!validScope(id)) throw new Error("Invalid conversation");
        const entry = listRememberedRooms().find(r => r.id === id);
        if (!entry?.ownerId) throw new Error("No local owner");
        let key: CryptoKey;
        if (entry.kind === "room") {
          const raw = parseRoomKey(entry.key ?? localStorage.getItem(`chatterbox.e2ee.room-key.${id.slice(5)}`) ?? "");
          if (!raw) throw new Error("Missing room key");
          key = await deriveRoomKey(raw, id);
        } else {
          const storageId = `stranger:${entry.ownerId}:${id.slice(9)}`;
          const identity = await loadIdentity(storageId), peer = await loadPartnerPin(storageId);
          if (!identity || !peer) throw new Error("Missing conversation key");
          key = await deriveConversationKey(identity, b64uDecode(peer), id);
        }
        const messages: DisplayMessage[] = [];
        for (const message of await loadHistory(id)) {
          const body = await decryptMessage(key, message.body, id, message.senderUserId);
          if (body !== null) messages.push({ ...message, body });
        }
        if (!cancelled) setState({ entry, messages });
      } catch { if (!cancelled) setError(true); }
    })();
    return () => { cancelled = true; };
  }, [id]);
  return <ChatShell activeId={id}>{state ? <ChatWindow initialMessages={[]} externalMessages={state.messages} selfUserId={state.entry.ownerId!} selfName={t("anonymous")} apiBase="" manageSSE={false} title={state.entry.title} subtitle={t("history")} status={{ kind: "warn", text: t("roomClosedTag") }} disabled encrypted customSend={async () => { throw new Error("Read-only history"); }} onLeave={() => router.push("/")} />
    : <main className="grid min-h-0 flex-1 place-items-center p-8 text-center"><section><h1 className="text-2xl">{t(error ? "historyEmpty" : "loading")}</h1>{error && <p className="mt-3 text-sm text-slate-400">Only messages and keys retained in this browser can be recovered. The server has no chat history.</p>}<button onClick={() => router.push("/")} className="mt-6 rounded-lg border border-slate-700 px-4 py-2">{t("backHomeBtn")}</button></section></main>}
  </ChatShell>;
}
