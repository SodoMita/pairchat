"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatWindow } from "@/app/_components/ChatWindow";
import { useI18n } from "@/app/_components/I18nProvider";
import { rememberRoom } from "@/app/local/_lib/rememberRooms";
import { ChatShell } from "@/app/_components/ChatShell";
import { useRoomCrypto } from "./useRoomCrypto";
import { parseEnvelope } from "@/lib/crypto";

type WireMessage = {
  id: string;
  scope: string;
  senderUserId: string;
  senderName: string;
  /** Envelope JSON for real messages; localized text for systemFlag. */
  body: string;
  createdAt: string;
  systemFlag: boolean;
};

type DisplayMessage = WireMessage & { body: string };

type Props = {
  userId: string | null;
  userName: string | null;
  roomId: string;
  inviteCode: string;
  isHost: boolean;
  closed: boolean;
  initialMessages: WireMessage[];
  initialPartnerName: string | null;
  shareUrl: string;
};

export function RoomChatClient({
  userId: initialUserId,
  userName: initialUserName,
  roomId,
  inviteCode,
  isHost: initialIsHost,
  closed,
  initialMessages,
  initialPartnerName,
  shareUrl,
}: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const [selfUserId, setSelfUserId] = useState<string | null>(initialUserId);
  const [selfName, setSelfName] = useState<string | null>(initialUserName);
  const [isHost, setIsHost] = useState(initialIsHost);
  const [roomAccess, setRoomAccess] = useState<"checking" | "ready" | "full" | "error" | "needs_passphrase">(
    initialIsHost ? "ready" : "checking",
  );
  const [passphrase, setPassphrase] = useState("");
  const roomCrypto = useRoomCrypto(roomId, initialIsHost);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);

  // Decrypt initial messages once the key is loaded.
  useEffect(() => {
    if (!roomCrypto.ready) return;
    let cancelled = false;
    (async () => {
      const out: DisplayMessage[] = [];
      for (const m of initialMessages) {
        if (m.systemFlag) {
          out.push({ ...m, body: t("roomClosedBody") });
          continue;
        }
        const env = parseEnvelope(m.body);
        if (!env) {
          out.push({ ...m, body: "[unsupported message]" });
          continue;
        }
        const plain = await roomCrypto.decrypt(m.body);
        if (cancelled) return;
        out.push({ ...m, body: plain ?? "[unable to decrypt]" });
      }
      if (!cancelled) setMessages(out);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCrypto.ready]);

  useEffect(() => {
    if (selfUserId) return;
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch("/api/me", { cache: "no-store" });
        if (!meRes.ok) return;
        const meData = (await meRes.json()) as {
          user: { id: string; displayName: string } | null;
        };
        if (cancelled) return;
        if (meData.user) {
          setSelfUserId(meData.user.id);
          setSelfName(meData.user.displayName);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selfUserId]);

  useEffect(() => {
    if (!selfUserId) return;
    rememberRoom({
      id: `room:${roomId}`,
      kind: "room",
      title: t("roomTitle"),
      active: true,
      key: roomCrypto.keyB64 ?? undefined,
    });
  }, [selfUserId, roomId, roomCrypto.keyB64, t]);

  // Guests must atomically claim the sole guest seat before SSE starts.
  // Hosts are already authorized by the server-rendered room ownership.
  useEffect(() => {
    if (!selfUserId) return;
    if (initialIsHost) {
      setIsHost(true);
      setRoomAccess("ready");
      return;
    }
    let cancelled = false;
    setRoomAccess("checking");
    (async () => {
      try {
        const joinRes = await fetch(`/api/rooms/${roomId}/join`, {
          method: "POST",
        });
        if (cancelled) return;
        if (joinRes.ok) {
          setIsHost(false);
          setRoomAccess("ready");
        } else if (joinRes.status === 401) {
          // Passphrase required. Show prompt.
          setRoomAccess("needs_passphrase");
        } else if (joinRes.status === 409) {
          setRoomAccess("full");
        } else {
          setRoomAccess("error");
        }
      } catch {
        if (!cancelled) setRoomAccess("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selfUserId, roomId, initialIsHost]);

  const onCloseRoom = useCallback(async () => {
    try {
      await fetch(`/api/rooms/${roomId}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
    router.refresh();
  }, [roomId, router]);

  const onLeave = useCallback(() => {
    router.push("/");
  }, [router]);

  // SSE for incoming encrypted messages; decrypt on arrival.
  useEffect(() => {
    if (closed || !roomCrypto.ready || roomAccess !== "ready") return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/rooms/${roomId}/messages`);
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
          void (async () => {
            const m = payload.message!;
            if (m.systemFlag) {
              setMessages((prev) =>
                prev.some((p) => p.id === m.id)
                  ? prev
                  : [...prev, { ...m, body: t("roomClosedBody") }],
              );
              return;
            }
            const plain = await roomCrypto.decrypt(m.body);
            setMessages((prev) =>
              prev.some((p) => p.id === m.id)
                ? prev
                : [...prev, { ...m, body: plain ?? "[unable to decrypt]" }],
            );
          })();
        }
      } catch {
        /* ignore */
      }
    });
    return () => {
      es?.close();
    };
  }, [closed, roomId, roomAccess, roomCrypto, t]);

  const sendEncrypted = useCallback(
    async (plaintext: string) => {
      if (!roomCrypto.ready || roomAccess !== "ready")
        throw new Error("Room not ready");
      const envelope = await roomCrypto.encrypt(plaintext);
      const res = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envelope }),
      });
      if (!res.ok) throw new Error("Send failed");
      const data = (await res.json()) as { message: WireMessage };
      setMessages((prev) => {
        if (prev.some((p) => p.id === data.message.id)) return prev;
        return [...prev, { ...data.message, body: plaintext }];
      });
    },
    [roomCrypto, roomId, roomAccess],
  );

  if (closed) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
        <div className="w-full max-w-md text-center">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-rose-300">
            {t("roomClosedTag")}
          </p>
          <h1 className="text-3xl font-bold">{t("roomClosedTitle")}</h1>
          <p className="mt-3 text-sm text-slate-400">{t("roomClosedBody")}</p>
          <div className="mt-8 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-400"
            >
              {t("backHomeBtn")}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (roomAccess === "needs_passphrase") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
        <div className="w-full max-w-md text-center">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-amber-300">
            🔐 {t("passphraseRequiredTitle")}
          </p>
          <h1 className="text-2xl font-bold">{t("passphraseRequiredTitle")}</h1>
          <p className="mt-3 text-sm text-slate-400">
            {t("passphraseRequiredBody")}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setRoomAccess("checking");
              try {
                const res = await fetch(`/api/rooms/${roomId}/join`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ passphrase: passphrase.trim() }),
                });
                if (res.ok) {
                  setRoomAccess("ready");
                } else if (res.status === 401) {
                  setRoomAccess("needs_passphrase");
                } else if (res.status === 409) {
                  setRoomAccess("full");
                } else {
                  setRoomAccess("error");
                }
              } catch {
                setRoomAccess("error");
              }
            }}
            className="mt-6 flex flex-col gap-3"
          >
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t("passphrasePlaceholder")}
              maxLength={128}
              autoFocus
              className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!passphrase.trim()}
              className="rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("passphraseSubmit")}
            </button>
          </form>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-4 text-xs text-slate-500 hover:text-slate-300"
          >
            {t("backHomeBtn")}
          </button>
        </div>
      </main>
    );
  }

  if (roomAccess === "full" || roomAccess === "error") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
        <div className="w-full max-w-md text-center">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-rose-300">
            {roomAccess === "full" ? t("roomFullTitle") : t("roomAccessErrorTitle")}
          </p>
          <h1 className="text-2xl font-bold">
            {roomAccess === "full" ? t("roomFullTitle") : t("roomAccessErrorTitle")}
          </h1>
          <p className="mt-3 text-sm text-slate-400">
            {roomAccess === "full" ? t("roomFullBody") : t("roomAccessErrorBody")}
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-6 rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-400"
          >
            {t("backHomeBtn")}
          </button>
        </div>
      </main>
    );
  }

  if (roomCrypto.keyMissing) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
        <div className="w-full max-w-md text-center">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-amber-300">
            🔐 {t("roomKeyMissingTitle")}
          </p>
          <h1 className="text-2xl font-bold">{t("roomKeyMissingTitle")}</h1>
          <p className="mt-3 text-sm text-slate-400">{t("roomKeyMissingBody")}</p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-6 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
          >
            {t("backHomeBtn")}
          </button>
        </div>
      </main>
    );
  }

  if (!selfUserId || !selfName || !roomCrypto.ready || roomAccess !== "ready") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
        <div className="text-center">
          <p className="text-sm text-slate-400">{t("loading")}</p>
        </div>
      </main>
    );
  }

  const status = initialPartnerName
    ? { kind: "ok" as const, text: t("statusConnected") }
    : { kind: "warn" as const, text: t("statusWaiting") };

  const title = initialPartnerName
    ? t("chatTitleWith", { name: initialPartnerName })
    : t("roomTitle");

  // Append the room key to the share URL when the host shares. The
  // server never sees it because it's in the fragment. The key is
  // produced by useRoomCrypto after mount and rewriteState'd into the
  // URL hash.
  const shareUrlWithKey = roomCrypto.keyB64
    ? `${shareUrl}#${encodeURIComponent(roomCrypto.keyB64)}`
    : shareUrl;

  return (
    <ChatShell activeId={`room:${roomId}`}>
      <ChatWindow
        initialMessages={messages}
        externalMessages={messages}
        manageSSE={false}
        selfUserId={selfUserId}
        selfName={selfName}
        apiBase={`/api/rooms/${roomId}/messages`}
        historyId={`room:${roomId}`}
        partnerName={initialPartnerName ?? undefined}
        partnerLabel={t("partnerLabel")}
        title={title}
        subtitle={t("inviteCodeLabel", { code: inviteCode })}
        shareUrl={shareUrlWithKey}
        status={status}
        placeholder={
          initialPartnerName
            ? t("inputPlaceholderConnected")
            : t("inputPlaceholderWaiting")
        }
        onCloseRoom={isHost ? onCloseRoom : undefined}
        onLeave={!isHost ? onLeave : undefined}
        customSend={sendEncrypted}
        encrypted
      />
    </ChatShell>
  );
}