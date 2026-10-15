"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatWindow } from "@/app/_components/ChatWindow";
import { useI18n } from "@/app/_components/I18nProvider";
import { rememberRoom } from "@/app/local/_lib/rememberRooms";
import { ChatShell } from "@/app/_components/ChatShell";
import { useStrangerCrypto } from "./useStrangerCrypto";

type WireMessage = {
  id: string;
  scope: string;
  senderUserId: string;
  senderName: string;
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
  /** Plaintext — already decrypted by the client. */
  body: string;
  createdAt: string;
  systemFlag: boolean;
};

type StrangerChatClientProps = {
  userId: string | null;
  userName: string | null;
  initialSession: { sessionId: string; partnerId: string | null } | null;
  initialMessages: WireMessage[];
  initialPartnerName: string | null;
};

export function StrangerChatClient({
  userId: initialUserIdProp,
  userName: initialUserNameProp,
  initialSession,
  initialMessages,
  initialPartnerName,
}: StrangerChatClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [selfUserId, setSelfUserId] = useState<string | null>(initialUserIdProp);
  const [selfName, setSelfName] = useState<string | null>(initialUserNameProp);
  const [session, setSession] = useState(initialSession);
  const [partnerName, setPartnerName] = useState<string | null>(initialPartnerName);
  const [ended, setEnded] = useState(false);
  const startedRef = useRef(false);

  // Crypto state. The hook generates an X25519 identity keypair on
  // mount and waits for the partner's public key.
  const crypto = useStrangerCrypto(session?.sessionId ?? null, selfUserId);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const partnerPubKeyByUserRef = useRef<Map<string, string>>(new Map());

  // Decrypt the initial messages once both my identity key and the
  // partner's static public key are available. For each message, the
  // sender's static pub key is `crypto.partnerKey` (they're the only
  // other participant); `m.senderPubKey` is the per-message ephemeral
  // public key sent alongside the ciphertext.
  useEffect(() => {
    const identity = crypto.identity;
    const partnerKey = crypto.partnerKey;
    if (!identity || !crypto.partnerKeyReady || !partnerKey) return;
    let cancelled = false;
    (async () => {
      const out: DisplayMessage[] = [];
      const senderStaticPub = b64u(partnerKey);
      for (const m of initialMessages) {
        if (m.systemFlag) {
          out.push(decryptDisplay(m, t("partnerLeftMsg", { label: partnerLabelFallback(m.senderName) })));
          continue;
        }
        if (!m.senderPubKey) {
          out.push({ ...m, body: "[unsupported message]" });
          continue;
        }
        const staticPub =
          m.senderUserId === selfUserId
            ? b64u(identity.publicKey)
            : senderStaticPub;
        const plain = await crypto.decrypt(m.body, staticPub, m.senderPubKey);
        if (cancelled) return;
        out.push({ ...m, body: plain ?? "[unable to decrypt]" });
      }
      if (!cancelled) setMessages(out);
    })();
    return () => {
      cancelled = true;
    };
    // intentional: we only run on identity/partner keypair ready, and
    // initialMessages is a one-shot input from the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crypto.identity, crypto.partnerKeyReady]);

  // Establish identity on mount if missing.
  useEffect(() => {
    if (selfUserId && selfName) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { user: { id: string; displayName: string } | null };
        if (cancelled) return;
        if (data.user) {
          setSelfUserId(data.user.id);
          setSelfName(data.user.displayName);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selfUserId, selfName]);

  const startMatchmaking = useCallback(async () => {
    try {
      const res = await fetch("/api/stranger/start", { method: "POST" });
      if (!res.ok) throw new Error("start failed");
      const data = (await res.json()) as
        | { state: "queued" }
        | {
            state: "paired";
            sessionId: string;
            partnerId: string | null;
            partnerIdentityPubKey: string | null;
          };
      if (data.state === "paired") {
        setSession({ sessionId: data.sessionId, partnerId: data.partnerId });
        rememberRoom({
          id: `stranger:${data.sessionId}`,
          kind: "stranger",
          title: t("chatTitleDefault"),
          active: true,
        });
      }
    } catch {
      /* ignore */
    }
  }, [t]);

  useEffect(() => {
    if (session) return;
    if (startedRef.current) return;
    startedRef.current = true;
    void startMatchmaking();
  }, [session, startMatchmaking]);

  useEffect(() => {
    if (session) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/stranger/start", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as
          | { state: "queued" }
          | {
              state: "paired";
              sessionId: string;
              partnerId: string | null;
              partnerIdentityPubKey: string | null;
            };
        if (data.state === "paired") {
          setSession({ sessionId: data.sessionId, partnerId: data.partnerId });
          rememberRoom({
            id: `stranger:${data.sessionId}`,
            kind: "stranger",
            title: t("chatTitleDefault"),
            active: true,
          });
        }
      } catch {
        /* ignore */
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [session, t]);

  // Append a received SSE message after decrypting it.
  const appendReceived = useCallback(
    async (m: WireMessage) => {
      if (m.systemFlag) {
        setMessages((prev) => [
          ...prev,
          {
            ...m,
            body: t("partnerLeftMsg", { label: partnerLabelFallback(m.senderName) }),
          },
        ]);
        return;
      }
      if (!m.senderPubKey) return; // can't decrypt, drop
      partnerPubKeyByUserRef.current.set(m.senderUserId, m.senderPubKey);
      // If we've already established the partner's static pub key from
      // the /api/stranger/partner-key endpoint, prefer that — but
      // since the partner-key hook only knows the static key, and the
      // senderPubKey on a message is the EPHEMERAL public key, we need
      // both. Our useStrangerCrypto.decrypt() takes (senderStaticPub,
      // senderEphemeralPub) so we need a way to know the static key.
      //
      // For a stranger 1:1 chat the only two participants are me and
      // the partner. The sender's STATIC pub key is whichever of those
      // two identities isn't me: if the sender is me, it's
      // crypto.identity.publicKey; otherwise it's crypto.partnerKey.
      // `m.senderPubKey` is the per-message EPHEMERAL public key sent
      // alongside the ciphertext.
      let plain: string | null = null;
      if (m.senderUserId === selfUserId && crypto.identity) {
        plain = await crypto.decrypt(
          m.body,
          b64u(crypto.identity.publicKey),
          m.senderPubKey,
        );
      } else if (crypto.partnerKey) {
        plain = await crypto.decrypt(
          m.body,
          b64u(crypto.partnerKey),
          m.senderPubKey,
        );
      }
      setMessages((prev) => {
        if (prev.some((p) => p.id === m.id)) return prev;
        return [
          ...prev,
          {
            ...m,
            body: plain ?? "[unable to decrypt]",
          },
        ];
      });
    },
    [crypto, selfUserId, t],
  );

  // Wire SSE inbound only after both keypairs are ready; this ensures
  // the replay snapshot cannot be rendered as raw ciphertext.
  useEffect(() => {
    if (!session || !crypto.identity || !crypto.partnerKeyReady) return;
    const sid = session.sessionId;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/stranger/messages/${sid}`);
    } catch {
      return;
    }
    es.addEventListener("message", (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as {
          type: string;
          message?: WireMessage;
        };
        if (payload.type === "message" && payload.message) {
          void appendReceived(payload.message);
        }
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("partner", (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as { type: string };
        if (payload.type === "partner_left") {
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-partner-${Date.now()}`,
              scope: `stranger:${sid}`,
              senderUserId: "system",
              senderName: "System",
              senderPubKey: null,
              body: t("partnerLeftMsg", {
                label: t("partnerLabel"),
              }),
              createdAt: new Date().toISOString(),
              systemFlag: true,
            },
          ]);
          setEnded(true);
        }
      } catch {
        /* ignore */
      }
    });
    return () => {
      es?.close();
    };
  }, [session, appendReceived, t]);

  // Custom send: encrypt with the hook, POST envelope + ephemeral pub key.
  const sendEncrypted = useCallback(
    async (plaintext: string) => {
      if (!crypto.partnerKeyReady || !crypto.identity || !session) {
        throw new Error("Crypto not ready");
      }
      const sealed = await crypto.encrypt(plaintext);
      const res = await fetch(
        `/api/stranger/messages/${session.sessionId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            envelope: sealed.envelope,
            ephemeralPubKey: sealed.ephemeralPubKey,
          }),
        },
      );
      if (!res.ok) throw new Error("Send failed");
      const data = (await res.json()) as { message: WireMessage };
      // Append optimistically with the plaintext we just sent. SSE will
      // also deliver it; dedup by id.
      setMessages((prev) => {
        if (prev.some((p) => p.id === data.message.id)) return prev;
        return [
          ...prev,
          {
            ...data.message,
            body: plaintext,
          },
        ];
      });
    },
    [crypto, session],
  );

  const onNext = useCallback(async () => {
    try {
      await fetch("/api/stranger/start", { method: "DELETE" });
    } catch {
      /* ignore */
    }
    setSession(null);
    setPartnerName(null);
    setMessages([]);
    setEnded(false);
    startedRef.current = false;
    startedRef.current = true;
    void startMatchmaking();
  }, [startMatchmaking]);

  const onLeave = useCallback(async () => {
    try {
      await fetch("/api/stranger/start", { method: "DELETE" });
    } catch {
      /* ignore */
    }
    router.push("/");
  }, [router]);

  // Pre-session: searching UI.
  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
        <div className="w-full max-w-md text-center">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-fuchsia-300">
            {t("searchingTag")}
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">
            {t("searchingTitle")}
          </h1>
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

  if (!selfUserId || !selfName) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
        <p className="text-sm text-slate-400">{t("loading")}</p>
      </main>
    );
  }

  // Waiting for partner's static pub key before we can encrypt.
  if (!crypto.partnerKeyReady || !crypto.identity) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
        <div className="w-full max-w-md text-center">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-emerald-300">
            🔐 {t("cryptoHandshakeTitle")}
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">
            {t("cryptoHandshakeTitle")}
          </h1>
          <p className="mt-3 text-sm text-slate-400">
            {t("cryptoHandshakeBody")}
          </p>
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

  const title = partnerName
    ? t("chatTitleWith", { name: partnerName })
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
        selfUserId={selfUserId}
        selfName={selfName}
        apiBase={`/api/stranger/messages/${session.sessionId}`}
        historyId={`stranger:${session.sessionId}`}
        partnerName={partnerName ?? undefined}
        partnerLabel={t("partnerLabel")}
        title={title}
        subtitle={t("chatSubtitle")}
        status={status}
        onEnded={() => setEnded(true)}
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

function decryptDisplay(m: WireMessage, fallbackBody: string): DisplayMessage {
  return { ...m, body: fallbackBody };
}

function partnerLabelFallback(_name: string): string {
  return "Stranger";
}

function b64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}