"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateRoomKey, hashProof, roomJoinProof } from "@/lib/crypto";
import { useI18n } from "./I18nProvider";

export function CreateRoomButton() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const create = async () => {
    if (pending) return;
    setPending(true); setError(false);
    try {
      const { key, encoded } = generateRoomKey();
      const joinTokenHash = await hashProof(await roomJoinProof(key));
      const request = () => fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ joinTokenHash, ...(showPassphrase && passphrase ? { passphrase } : {}) }) });
      const res = navigator.locks ? await navigator.locks.request("chatterbox-entry", request) : await request();
      if (!res.ok) throw new Error("Create failed");
      const { room } = await res.json() as { room: { id: string } };
      localStorage.setItem(`chatterbox.e2ee.room-key.${room.id}`, encoded);
      // Fragment is never submitted to HTTP. Do not navigate via a query key.
      router.push(`/room/${room.id}#${encoded}`);
    } catch { setError(true); setPending(false); }
  };
  return <div className="flex w-full flex-col items-start gap-2">
    <button type="button" onClick={() => void create()} disabled={pending} className="rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-400 disabled:opacity-60">{pending ? t("creatingRoom") : t("createRoom")}</button>
    <button type="button" disabled={pending} onClick={() => setShowPassphrase(!showPassphrase)} className="text-xs text-slate-400 hover:text-slate-200">{t(showPassphrase ? "passphraseHide" : "passphraseAdd")}</button>
    {showPassphrase && <input aria-label={t("passphraseFieldPlaceholder")} type="password" autoComplete="new-password" value={passphrase} maxLength={128} disabled={pending} onChange={e => setPassphrase(e.target.value)} placeholder={t("passphraseFieldPlaceholder")} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs" />}
    {error && <span role="alert" className="text-xs text-rose-300">{t("serviceUnavailable")}</span>}
  </div>;
}
