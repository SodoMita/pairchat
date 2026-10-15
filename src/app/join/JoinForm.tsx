"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/app/_components/I18nProvider";

export function JoinForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function extractTarget(raw: string): { roomId: string; key?: string } | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const urlMatch = trimmed.match(/\/room\/([A-Za-z0-9_-]+)(?:#([^\s]+))?/);
    if (urlMatch) return { roomId: urlMatch[1], key: urlMatch[2] };
    const direct = trimmed.replace(/\s+/g, "");
    if (direct.length >= 4 && direct.length <= 100) {
      const [roomId, key] = direct.split("#", 2);
      return { roomId, key };
    }
    return null;
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const target = extractTarget(value);
    if (!target) {
      setError(t("joinError"));
      return;
    }
    setError(null);
    router.push(
      `/room/${target.roomId}${target.key ? `#${encodeURIComponent(target.key)}` : ""}`,
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("joinPlaceholder")}
        className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-fuchsia-400 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-xl bg-gradient-to-br from-fuchsia-500 to-rose-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/30 transition hover:from-fuchsia-400 hover:to-rose-400"
      >
        {t("joinSubmit")}
      </button>
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </form>
  );
}