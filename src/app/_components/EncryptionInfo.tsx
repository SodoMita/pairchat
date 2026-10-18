"use client";
import { useI18n } from "./I18nProvider";
export function EncryptionInfo({ code }: { code?: string | null }) {
  const { t } = useI18n();
  return <details className="relative text-xs text-emerald-200">
    <summary className="cursor-pointer rounded-lg border border-emerald-500/30 px-3 py-2">🔐 {t("encryptedBadge")}</summary>
    <div className="absolute end-0 top-full z-20 mt-2 w-80 max-w-[85vw] rounded-xl border border-slate-700 bg-slate-900 p-4 text-slate-300 shadow-xl">
      <p>Messages are encrypted in your browser. History stays on this device. The relay can see participants, timing and sizes.</p>
      {code && <><p className="mt-3">Compare this safety code with your partner using another trusted channel. A match confirms the key exchange, not the stranger’s identity.</p><code dir="ltr" className="mt-2 block break-all rounded bg-slate-950 p-2 text-emerald-200">{code}</code></>}
      <p className="mt-3">Not independently audited. No forward secrecy. A compromised browser or modified site JavaScript can expose messages.</p>
    </div>
  </details>;
}
