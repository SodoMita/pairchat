"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChatWindow } from "@/app/_components/ChatWindow";
import { ChatShell } from "@/app/_components/ChatShell";
import { useI18n } from "@/app/_components/I18nProvider";
import { rememberRoom } from "@/app/local/_lib/rememberRooms";
import { useRoomCrypto } from "./useRoomCrypto";

type WireMessage = {
  id: string;
  scope: string;
  senderUserId: string;
  senderName: string;
  /** AES-GCM envelope JSON — the server never sees plaintext. */
  body: string;
  createdAt: string;
  systemFlag: boolean;
};

type Me = { id: string; displayName: string };
type RoomInfo = {
  id: string;
  inviteCode: string;
  role: "host" | "guest";
  hasPassphrase: boolean;
};

type Access =
  | { phase: "checking" }
  | { phase: "passphrase"; wrong: boolean }
  | { phase: "ready" }
  | { phase: "closed" | "full" | "notfound" | "error" };

/**
 * Private room. A static shell: after load it makes exactly one request,
 * `POST /api/rooms/[id]/enter`, which resolves the room (id or invite
 * code), claims the guest seat, and returns who I am and who my partner
 * is — replacing the old `/api/me` + `/join` + server-rendered page data.
 * Messages (including history) then arrive over a single SSE stream.
 */
export function RoomChatClient() {
  const params = useParams<{ id: string }>();
  const ref = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { t } = useI18n();

  const [access, setAccess] = useState<Access>({ phase: "checking" });
  const [me, setMe] = useState<Me | null>(null);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [messages, setMessages] = useState<WireMessageDisplay[]>([]);

  const roomCrypto = useRoomCrypto(room?.id ?? null, room?.role === "host");
  /** The id we already resolved, so a canonicalised URL doesn't re-enter. */
  const resolvedRef = useRef<string | null>(null);

  const enter = useCallback(
    async (pass?: string) => {
      setAccess({ phase: "checking" });
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(ref)}/enter`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pass ? { passphrase: pass } : {}),
        });
        if (res.status === 401) return setAccess({ phase: "passphrase", wrong: !!pass });
        if (res.status === 404) return setAccess({ phase: "notfound" });
        if (res.status === 410) return setAccess({ phase: "closed" });
        if (res.status === 409) return setAccess({ phase: "full" });
        if (!res.ok) return setAccess({ phase: "error" });

        const data = (await res.json()) as {
          me: Me;
          room: RoomInfo;
          partner: { displayName: string } | null;
        };
        resolvedRef.current = data.room.id;
        setMe(data.me);
        setRoom(data.room);
        setPartnerName(data.partner?.displayName ?? null);
        setAccess({ phase: "ready" });
        // If the visitor typed an invite code, show the canonical URL while
        // preserving the #key fragment (which never reaches the server).
        if (data.room.id !== ref) {
          window.history.replaceState(
            null,
            "",
            `/room/${data.room.id}${window.location.hash}`,
          );
        }
      } catch {
        setAccess({ phase: "error" });
      }
    },
    [ref],
  );

  useEffect(() => {
    if (!ref || resolvedRef.current === ref) return;
    void enter();
  }, [ref, enter]);

  useEffect(() => {
    if (!room) return;
    rememberRoom({
      id: `room:${room.id}`,
      kind: "room",
      title: t("roomTitle"),
      active: true,
      key: roomCrypto.keyB64 ?? undefined,
    });
  }, [room, roomCrypto.keyB64, t]);

  // ---- Encrypted message stream (history + live) -------------------------
  useEffect(() => {
    if (!room || !me || access.phase !== "ready" || !roomCrypto.ready) return;
    const es = new EventSource(`/api/rooms/${room.id}/messages`);
    es.addEventListener("message", (ev) => {
      let payload: {
        type: string;
        message?: WireMessage;
        displayName?: string;
      };
      try {
        payload = JSON.parse((ev as MessageEvent).data);
      } catch {
        return;
      }
      if (payload.type === "guest_joined") {
        setPartnerName(payload.displayName ?? t("partnerLabel"));
      } else if (payload.type === "room_closed") {
        setAccess({ phase: "closed" });
      } else if (payload.type === "message" && payload.message) {
        const m = payload.message;
        if (m.senderUserId !== me.id) {
          setPartnerName((prev) => prev ?? m.senderName);
        }
        void (async () => {
          const plain = m.systemFlag ? m.body : await roomCrypto.decrypt(m.body);
          const display: WireMessageDisplay = {
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
        })();
      }
    });
    return () => es.close();
  }, [room, me, access.phase, roomCrypto, t]);

  const sendEncrypted = useCallback(
    async (plaintext: string) => {
      if (!room || !roomCrypto.ready || access.phase !== "ready") {
        throw new Error("Room not ready");
      }
      const envelope = await roomCrypto.encrypt(plaintext);
      const res = await fetch(`/api/rooms/${room.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envelope }),
      });
      if (!res.ok) throw new Error("Send failed");
      const data = (await res.json()) as { message: WireMessage };
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
    [room, roomCrypto, access.phase],
  );

  const onCloseRoom = useCallback(async () => {
    if (!room) return;
    try {
      await fetch(`/api/rooms/${room.id}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
    setAccess({ phase: "closed" });
  }, [room]);

  const onLeave = useCallback(() => router.push("/"), [router]);

  // ---- Render ------------------------------------------------------------
  const centered = (children: React.ReactNode) => (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
      <div className="w-full max-w-md text-center">{children}</div>
    </main>
  );
  const homeButton = (
    <button
      type="button"
      onClick={() => router.push("/")}
      className="mt-6 rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-400"
    >
      {t("backHomeBtn")}
    </button>
  );

  if (access.phase === "closed") {
    return centered(
      <>
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-rose-300">
          {t("roomClosedTag")}
        </p>
        <h1 className="text-3xl font-bold">{t("roomClosedTitle")}</h1>
        <p className="mt-3 text-sm text-slate-400">{t("roomClosedBody")}</p>
        {homeButton}
      </>,
    );
  }

  if (access.phase === "notfound" || access.phase === "full" || access.phase === "error") {
    const full = access.phase === "full";
    return centered(
      <>
        <h1 className="text-2xl font-bold">
          {full ? t("roomFullTitle") : t("roomAccessErrorTitle")}
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          {full ? t("roomFullBody") : t("roomAccessErrorBody")}
        </p>
        {homeButton}
      </>,
    );
  }

  if (access.phase === "passphrase") {
    return centered(
      <>
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-amber-300">
          🔐 {t("passphraseRequiredTitle")}
        </p>
        <h1 className="text-2xl font-bold">{t("passphraseRequiredTitle")}</h1>
        <p className="mt-3 text-sm text-slate-400">{t("passphraseRequiredBody")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enter(passphrase.trim());
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
            className={`rounded-xl border bg-slate-900 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none ${
              access.wrong
                ? "border-rose-500 focus:border-rose-400"
                : "border-slate-700 focus:border-amber-400"
            }`}
          />
          <button
            type="submit"
            disabled={!passphrase.trim()}
            className="rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("passphraseSubmit")}
          </button>
        </form>
      </>,
    );
  }

  if (roomCrypto.keyMissing) {
    return centered(
      <>
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-amber-300">
          🔐 {t("roomKeyMissingTitle")}
        </p>
        <h1 className="text-2xl font-bold">{t("roomKeyMissingTitle")}</h1>
        <p className="mt-3 text-sm text-slate-400">{t("roomKeyMissingBody")}</p>
        {homeButton}
      </>,
    );
  }

  if (!room || !me || !roomCrypto.ready) {
    return centered(<p className="text-sm text-slate-400">{t("loading")}</p>);
  }

  const isHost = room.role === "host";
  const status = partnerName
    ? { kind: "ok" as const, text: t("statusConnected") }
    : { kind: "warn" as const, text: t("statusWaiting") };
  const title = partnerName
    ? t("chatTitleWith", { name: partnerName })
    : t("roomTitle");
  // The key rides in the URL fragment, which browsers never send to a server.
  const shareUrl = `${window.location.origin}/room/${room.id}${
    roomCrypto.keyB64 ? `#${encodeURIComponent(roomCrypto.keyB64)}` : ""
  }`;

  return (
    <ChatShell activeId={`room:${room.id}`}>
      <ChatWindow
        initialMessages={messages}
        externalMessages={messages}
        manageSSE={false}
        selfUserId={me.id}
        selfName={me.displayName}
        apiBase={`/api/rooms/${room.id}/messages`}
        historyId={`room:${room.id}`}
        partnerName={partnerName ?? undefined}
        partnerLabel={t("partnerLabel")}
        title={title}
        subtitle={t("inviteCodeLabel", { code: room.inviteCode })}
        shareUrl={shareUrl}
        status={status}
        placeholder={
          partnerName ? t("inputPlaceholderConnected") : t("inputPlaceholderWaiting")
        }
        onCloseRoom={isHost ? onCloseRoom : undefined}
        onLeave={!isHost ? onLeave : undefined}
        customSend={sendEncrypted}
        encrypted
      />
    </ChatShell>
  );
}

type WireMessageDisplay = Omit<WireMessage, "body"> & { body: string };
