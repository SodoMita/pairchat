"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChatWindow } from "@/app/_components/ChatWindow";
import { ChatShell } from "@/app/_components/ChatShell";
import { EncryptionInfo } from "@/app/_components/EncryptionInfo";
import { useEncryptedConversation } from "@/app/_components/useEncryptedConversation";
import { useI18n } from "@/app/_components/I18nProvider";
import { rememberRoom, touchRoom } from "@/app/local/_lib/rememberRooms";
import { b64uEncode, roomJoinProof } from "@/lib/crypto";
import { readRoomSecret, ROOM_KEY_PREFIX, useRoomCrypto } from "./useRoomCrypto";
type Me = { id: string; displayName: string };
type Room = { id: string; inviteCode: string; role: "host" | "guest" };
type Phase = "checking" | "passphrase" | "ready" | "closed" | "full" | "missing" | "error";

export function RoomChatClient() {
  const params = useParams<{ id: string }>();
  // A route change must unmount the old encrypted conversation before accepting
  // async messages from it (otherwise histories could mix between rooms).
  return <RoomView key={params.id} roomRef={params.id} />;
}
function RoomView({ roomRef }: { roomRef: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("checking");
  const [me, setMe] = useState<Me | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [partnerPresent, setPartnerPresent] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [wrong, setWrong] = useState(false);
  const mounted = useRef(true);
  const crypto = useRoomCrypto(room?.id ?? null);
  const scope = room ? `room:${room.id}` : null;
  const conversation = useEncryptedConversation({ scope, apiBase: room ? `/api/rooms/${room.id}/messages` : null, key: crypto.key, me, ended: phase === "closed", onControl: value => {
    if (value.type === "guest_joined") { setPartnerPresent(true); setPartnerName(typeof value.displayName === "string" ? value.displayName : t("partnerLabel")); }
    if (value.type === "state" && typeof value.partnerPresent === "boolean") setPartnerPresent(value.partnerPresent);
    if (value.type === "room_closed") setPhase("closed");
  } });

  const enter = useCallback(async (password?: string) => {
    setPhase("checking");
    try {
      const raw = readRoomSecret(roomRef);
      if (!raw) { setPhase("missing"); return; }
      const proof = await roomJoinProof(raw);
      const request = () => fetch(`/api/rooms/${encodeURIComponent(roomRef)}/enter`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proof, ...(password ? { passphrase: password } : {}) }) });
      const response = navigator.locks ? await navigator.locks.request("chatterbox-entry", request) : await request();
      if (!mounted.current) return;
      if (response.status === 401) { setWrong(!!password); setPhase("passphrase"); return; }
      if (response.status === 403) { setPhase("missing"); return; }
      if (response.status === 410) { setPhase("closed"); return; }
      if (response.status === 409) { setPhase("full"); return; }
      if (!response.ok) throw new Error("Cannot enter");
      const data = await response.json() as { me: Me; room: Room; partner: { displayName: string } | null };
      if (!mounted.current) return;
      localStorage.setItem(ROOM_KEY_PREFIX + data.room.id, b64uEncode(raw));
      setRoom(data.room); setMe(data.me); setPartnerName(data.partner?.displayName ?? null); setPartnerPresent(!!data.partner); setPhase("ready"); setPassphrase("");
    } catch { if (mounted.current) setPhase("error"); }
  }, [roomRef]);
  useEffect(() => { mounted.current = true; void enter(); return () => { mounted.current = false; }; }, [enter]);
  useEffect(() => {
    if (scope && room) rememberRoom({ id: scope, kind: "room", title: partnerName ?? `${t("roomTitle")} · ${room.inviteCode}`, active: phase !== "closed", key: crypto.keyB64 ?? undefined, ownerId: me?.id });
  }, [scope, room, crypto.keyB64, partnerName, phase, me?.id, t]);

  const endChat = useCallback(() => {
    if (!room) return;
    setPhase("closed");
    touchRoom(`room:${room.id}`, { active: false });
    void fetch(`/api/rooms/${room.id}`, { method: "DELETE", keepalive: true }).catch(() => {});
  }, [room]);
  const home = () => router.push("/");
  const error = crypto.error || conversation.error;
  return <ChatShell activeId={scope}>
    {error && <p role="alert" className="border-b border-amber-700 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{error}</p>}
    {(phase === "ready" || phase === "closed") && room && me && crypto.key ? <ChatWindow key={room.id} initialMessages={[]} externalMessages={conversation.messages} manageSSE={false}
      selfUserId={me.id} selfName={me.displayName} apiBase={`/api/rooms/${room.id}/messages`} historyId={scope!}
      title={partnerName ? t("chatTitleWith", { name: partnerName }) : t("roomTitle")}
      subtitle={t("inviteCodeLabel", { code: room.inviteCode })}
      shareUrl={`${window.location.origin}/room/${room.id}#${crypto.keyB64}`}
      status={{ kind: phase === "closed" ? "warn" : conversation.connected ? "ok" : "warn", text: t(phase === "closed" ? "roomClosedTag" : conversation.connected ? partnerPresent ? "statusConnected" : "statusWaiting" : "loading") }}
      disabled={phase === "closed" || !conversation.connected || !!crypto.error} customSend={conversation.send} onCloseRoom={phase !== "closed" ? endChat : undefined} onLeave={phase === "closed" ? home : undefined} encrypted headerRight={<EncryptionInfo />} />
      : <main className="grid min-h-0 flex-1 place-items-center p-6 text-center"><section className="w-full max-w-md">
        <h1 className="text-2xl font-bold">{t(phase === "missing" ? "roomKeyMissingTitle" : phase === "passphrase" ? "passphraseRequiredTitle" : phase === "full" ? "roomFullTitle" : phase === "closed" ? "roomClosedTitle" : phase === "error" ? "roomAccessErrorTitle" : "loading")}</h1>
        <p className="mt-3 text-sm text-slate-400">{phase === "missing" ? t("roomKeyMissingBody") : phase === "passphrase" ? t("passphraseRequiredBody") : phase === "full" ? t("roomFullBody") : phase === "error" ? t("roomAccessErrorBody") : ""}</p>
        {phase === "passphrase" && <form onSubmit={e => { e.preventDefault(); void enter(passphrase); }} className="mt-6 flex flex-col gap-3">
          <input type="password" autoComplete="current-password" aria-label={t("passphrasePlaceholder")} placeholder={t("passphrasePlaceholder")} aria-invalid={wrong} value={passphrase} onChange={e => setPassphrase(e.target.value)} maxLength={128} autoFocus className={`rounded-xl border bg-slate-900 p-3 text-sm ${wrong ? "border-rose-400" : "border-slate-700"}`} />
          {wrong && <p role="alert" className="text-sm text-rose-300">Incorrect passphrase. Please try again.</p>}
          <button className="rounded-xl bg-fuchsia-500 p-3" disabled={!passphrase}>{t("passphraseSubmit")}</button>
        </form>}
        <button onClick={home} className="mt-6 rounded-lg border border-slate-700 px-4 py-2">{t("backHomeBtn")}</button>
      </section></main>}
  </ChatShell>;
}
