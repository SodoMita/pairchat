"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatWindow } from "@/app/_components/ChatWindow";
import { ChatShell } from "@/app/_components/ChatShell";
import { useI18n } from "@/app/_components/I18nProvider";
import { rememberRoom } from "@/app/local/_lib/rememberRooms";
import { useStrangerCrypto } from "./useStrangerCrypto";

type WireMessage = {
  id: string;
  scope: string;
  senderUserId: string;
  senderName: string;
  /** AES-GCM envelope JSON — the server never sees plaintext. */
  body: string;
  senderPubKey: string | null;
  createdAt: string;
  systemFlag: boolean;
};

type DisplayMessage = {
  id: string;
  scope: string;
  senderUserId: string;
  senderName: string;
  /** Plaintext, decrypted in this browser. */
  body: string;
  createdAt: string;
  systemFlag: boolean;
};

type Me = { id: string; displayName: string };
type Session = { sessionId: string; partnerName: string | null };
type PairedPayload = {
  sessionId: string;
  partnerName?: string | null;
  partnerLeft?: boolean;
  partnerKey?: string | null;
};

const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Stranger roulette. The page is a static shell; everything dynamic
 * arrives over two connections to our own server:
 *
 *   POST /api/stranger/start   once per match: join the queue, learn who I am
 *   GET  /api/stranger/events  one SSE stream: paired / partner key / left
 *
 * plus the per-session message stream once keys are exchanged. There is no
 * polling and no `/api/me` call.
 */
export function StrangerChatClient() {
  const router = useRouter();
  const { t } = useI18n();

  const [me, setMe] = useState<Me | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [partnerKeyB64, setPartnerKeyB64] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [netError, setNetError] = useState(false);
  /** Bumped to (re)start matching: "Next stranger" and error retries. */
  const [attempt, setAttempt] = useState(0);
  const failuresRef = useRef(0);

  const e2ee = useStrangerCrypto(
    session?.sessionId ?? null,
    me?.id ?? null,
    partnerKeyB64,
  );

  // ---- Matching + event stream ------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let events: EventSource | null = null;
    setSession(null);
    setPartnerKeyB64(null);
    setEnded(false);
    setMessages([]);
    setNetError(false);

    const applyPaired = (p: PairedPayload) => {
      // Idempotent: the same session may be reported by the POST response,
      // the stream's `state` event, and a `paired` event.
      setSession((prev) =>
        prev?.sessionId === p.sessionId
          ? prev
          : { sessionId: p.sessionId, partnerName: p.partnerName ?? null },
      );
      if (p.partnerLeft) setEnded(true);
      // Keys only ever move forward: never clear one on a stale snapshot.
      if (p.partnerKey) setPartnerKeyB64(p.partnerKey);
    };

    (async () => {
      try {
        const res = await fetch("/api/stranger/start", { method: "POST" });
        if (!res.ok) throw new Error("start failed");
        const data = (await res.json()) as {
          state: "queued" | "paired";
          me: Me;
        } & Partial<PairedPayload>;
        if (cancelled) return;
        failuresRef.current = 0;
        setMe(data.me);
        if (data.state === "paired" && data.sessionId) {
          applyPaired(data as PairedPayload);
        }
      } catch {
        if (!cancelled) setNetError(true);
        return;
      }

      // Opened only after /start resolved so a first-time visitor's account
      // exists before the stream authenticates (no duplicate-user race).
      events = new EventSource("/api/stranger/events");
      const parse = (ev: MessageEvent) => JSON.parse(ev.data);
      events.addEventListener("state", (ev) => {
        const d = parse(ev as MessageEvent);
        if (d.state === "paired") applyPaired(d);
      });
      events.addEventListener("paired", (ev) => applyPaired(parse(ev as MessageEvent)));
      events.addEventListener("partner_key", (ev) => {
        const d = parse(ev as MessageEvent);
        if (typeof d.key === "string") setPartnerKeyB64(d.key);
      });
      events.addEventListener("partner_left", () => setEnded(true));
    })();

    return () => {
      cancelled = true;
      events?.close();
    };
  }, [attempt]);

  // Retry with exponential backoff (auto-retrying at a fixed short interval
  // against a down server would only add traffic).
  useEffect(() => {
    if (!netError) return;
    failuresRef.current += 1;
    const delay = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * 2 ** (failuresRef.current - 1),
    );
    const id = setTimeout(() => setAttempt((a) => a + 1), delay);
    return () => clearTimeout(id);
  }, [netError]);

  useEffect(() => {
    if (!session) return;
    rememberRoom({
      id: `stranger:${session.sessionId}`,
      kind: "stranger",
      title: t("chatTitleDefault"),
      active: true,
    });
  }, [session, t]);

  // ---- Encrypted message stream -----------------------------------------
  const ingest = useCallback(
    async (m: WireMessage) => {
      if (!me || !e2ee.identity || !e2ee.partnerKey || !m.senderPubKey) return;
      // The sender's static key is mine or my partner's; 1:1 chat.
      const senderStatic =
        m.senderUserId === me.id ? e2ee.identity.publicKey : e2ee.partnerKey;
      const plain = await e2ee.decrypt(m.body, senderStatic, m.senderPubKey);
      const display: DisplayMessage = {
        id: m.id,
        scope: m.scope,
        senderUserId: m.senderUserId,
        senderName: m.senderName,
        body: plain ?? "[unable to decrypt]",
        createdAt: m.createdAt,
        systemFlag: m.systemFlag,
      };
      setMessages((prev) =>
        prev.some((p) => p.id === display.id)
          ? prev
          : [...prev, display].sort((a, b) =>
              a.createdAt.localeCompare(b.createdAt),
            ),
      );
    },
    [me, e2ee],
  );

  // Opened only once both keys exist, so the replayed history can never be
  // shown as raw ciphertext.
  useEffect(() => {
    if (!session || !me || !e2ee.identity || !e2ee.partnerKey) return;
    const es = new EventSource(`/api/stranger/messages/${session.sessionId}`);
    es.addEventListener("message", (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as {
          type: string;
          message?: WireMessage;
        };
        if (payload.type === "message" && payload.message) {
          void ingest(payload.message);
        }
      } catch {
        /* ignore malformed */
      }
    });
    return () => es.close();
  }, [session, me, e2ee.identity, e2ee.partnerKey, ingest]);

  useEffect(() => {
    if (!ended || !session) return;
    const id = `sys-left-${session.sessionId}`;
    setMessages((prev) =>
      prev.some((p) => p.id === id)
        ? prev
        : [
            ...prev,
            {
              id,
              scope: `stranger:${session.sessionId}`,
              senderUserId: "system",
              senderName: "System",
              body: t("partnerLeftMsg", { label: t("partnerLabel") }),
              createdAt: new Date().toISOString(),
              systemFlag: true,
            },
          ],
    );
  }, [ended, session, t]);

  const sendEncrypted = useCallback(
    async (plaintext: string) => {
      if (!session || !me || !e2ee.identity || !e2ee.partnerKey) {
        throw new Error("Crypto not ready");
      }
      const sealed = await e2ee.encrypt(plaintext);
      const res = await fetch(`/api/stranger/messages/${session.sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          envelope: sealed.envelope,
          ephemeralPubKey: sealed.ephemeralPubKey,
        }),
      });
      if (!res.ok) throw new Error("Send failed");
      const data = (await res.json()) as { message: WireMessage };
      // Show my own message immediately (I already have the plaintext);
      // the stream's copy is de-duplicated by id.
      setMessages((prev) =>
        prev.some((p) => p.id === data.message.id)
          ? prev
          : [
              ...prev,
              {
                id: data.message.id,
                scope: data.message.scope,
                senderUserId: data.message.senderUserId,
                senderName: data.message.senderName,
                body: plaintext,
                createdAt: data.message.createdAt,
                systemFlag: false,
              },
            ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      );
    },
    [session, me, e2ee],
  );

  // Next: the server must forget the old pairing before we queue again, so
  // this one waits for the DELETE.
  const onNext = useCallback(async () => {
    try {
      await fetch("/api/stranger/start", { method: "DELETE" });
    } catch {
      /* ignore */
    }
    setAttempt((a) => a + 1);
  }, []);

  // Leave is local-first: navigate now, tell the server in the background.
  const onLeave = useCallback(() => {
    void fetch("/api/stranger/start", { method: "DELETE", keepalive: true }).catch(
      () => {},
    );
    router.push("/");
  }, [router]);

  // ---- Render ------------------------------------------------------------
  if (netError) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-bold">{t("serviceUnavailable")}</h1>
          <p className="mt-6 text-xs text-slate-500">
            <a href="/" className="hover:underline">
              {t("backHome")}
            </a>
          </p>
        </div>
      </main>
    );
  }

  if (!session || !me) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
        <div className="w-full max-w-md text-center">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-fuchsia-300">
            {t("searchingTag")}
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">{t("searchingTitle")}</h1>
          <p className="mt-3 text-sm text-slate-400">{t("searchingBody")}</p>
          <div className="mx-auto mt-8 flex max-w-sm items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm text-slate-300 ring-1 ring-slate-800">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
            </span>
            {t("searchingStatus")}
          </div>
          <p className="mt-6 text-xs text-slate-500">
            <a href="/" className="hover:underline">
              {t("backHome")}
            </a>
          </p>
        </div>
      </main>
    );
  }

  if (!e2ee.identity || !e2ee.partnerKeyReady) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
        <div className="w-full max-w-md text-center">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-emerald-300">
            🔐 {t("cryptoHandshakeTitle")}
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">
            {t("cryptoHandshakeTitle")}
          </h1>
          <p className="mt-3 text-sm text-slate-400">{t("cryptoHandshakeBody")}</p>
          <div className="mx-auto mt-8 flex max-w-sm items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm text-slate-300 ring-1 ring-slate-800">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            {t("cryptoHandshakeStatus")}
          </div>
        </div>
      </main>
    );
  }

  const title = session.partnerName
    ? t("chatTitleWith", { name: session.partnerName })
    : t("chatTitleDefault");
  const status = ended
    ? { kind: "warn" as const, text: t("statusPartnerLeft") }
    : { kind: "ok" as const, text: t("statusConnected") };

  return (
    <ChatShell activeId={`stranger:${session.sessionId}`}>
      <ChatWindow
        initialMessages={messages}
        externalMessages={messages}
        manageSSE={false}
        selfUserId={me.id}
        selfName={me.displayName}
        apiBase={`/api/stranger/messages/${session.sessionId}`}
        historyId={`stranger:${session.sessionId}`}
        partnerName={session.partnerName ?? undefined}
        partnerLabel={t("partnerLabel")}
        title={title}
        subtitle={t("chatSubtitle")}
        status={status}
        onNext={onNext}
        onLeave={onLeave}
        disabled={ended}
        placeholder={t("inputPlaceholder")}
        customSend={sendEncrypted}
        encrypted
      />
    </ChatShell>
  );
}
