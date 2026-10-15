"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./I18nProvider";

export function CreateRoomButton() {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const res = await fetch("/api/rooms", { method: "POST" });
              if (!res.ok) throw new Error("Failed to create room");
              const data = (await res.json()) as { room: { id: string } };
              router.push(`/room/${data.room.id}`);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed");
            }
          });
        }}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/20 transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? t("creatingRoom") : t("createRoom")}
      </button>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  );
}