"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";

/**
 * Tiny live indicator for the landing page. Pings /api/health every 15s
 * so visitors can tell whether the service is currently up. Also exposes
 * a queue depth gauge for the stranger roulette by calling a lightweight
 * endpoint.
 */
export function ServiceStatus() {
  const { t } = useI18n();
  const [state, setState] = useState<"loading" | "up" | "down">("loading");

  useEffect(() => {
    let cancelled = false;
    async function ping() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (cancelled) return;
        setState(res.ok ? "up" : "down");
      } catch {
        if (!cancelled) setState("down");
      }
    }
    void ping();
    const id = setInterval(ping, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const dot =
    state === "loading"
      ? "bg-slate-500"
      : state === "up"
      ? "bg-emerald-400"
      : "bg-rose-400";
  const label =
    state === "loading"
      ? "—"
      : state === "up"
      ? t("statusConnected")
      : t("serviceUnavailable");
  const ring =
    state === "up"
      ? "ring-emerald-500/30"
      : state === "down"
      ? "ring-rose-500/30"
      : "ring-slate-700";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full bg-slate-900/60 px-3 py-1 text-[11px] font-medium text-slate-300 ring-1 ring-inset ${ring}`}
      title="Service heartbeat"
    >
      <span className="relative flex h-2 w-2">
        {state === "up" && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dot} opacity-75`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
      </span>
      {label}
    </span>
  );
}