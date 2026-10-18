"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";

type Stats = {
  waiting: number;
  activeChats: number;
  totalMessages: number;
  totalRooms: number;
};

const POLL_MS = 30_000;
const MIN_GAP_MS = 10_000;

/**
 * The landing page's only network call. One request to `/api/stats` yields
 * both the service-status dot (a failed request means "unavailable") and the
 * counters — replacing the separate `/api/health` (15s) and `/api/stats`
 * (10s) pollers. It refreshes every 30s, only while the tab is visible,
 * and immediately when the tab becomes visible again.
 */
export function LiveStatus() {
  const { t } = useI18n();
  const [state, setState] = useState<"loading" | "up" | "down">("loading");
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastLoad = 0;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), POLL_MS);
    };

    async function load() {
      if (document.visibilityState !== "visible") {
        schedule();
        return;
      }
      lastLoad = Date.now();
      try {
        const res = await fetch("/api/stats");
        if (!res.ok) throw new Error("unavailable");
        const data = (await res.json()) as Stats;
        if (!cancelled) {
          setStats(data);
          setState("up");
        }
      } catch {
        if (!cancelled) setState("down");
      }
      if (!cancelled) schedule();
    }

    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastLoad > MIN_GAP_MS
      ) {
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    void load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const dot =
    state === "up"
      ? "bg-emerald-400"
      : state === "down"
        ? "bg-rose-400"
        : "bg-slate-500";
  const ring =
    state === "up"
      ? "ring-emerald-500/30"
      : state === "down"
        ? "ring-rose-500/30"
        : "ring-slate-700";
  const label =
    state === "loading"
      ? "—"
      : state === "up"
        ? t("statusConnected")
        : t("serviceUnavailable");

  const counters: Array<[string, string, number, string]> = stats
    ? [
        ["statsWaiting", "text-indigo-300", stats.waiting, ""],
        ["statsActive", "text-emerald-300", stats.activeChats, ""],
        ["statsMessages", "text-slate-300", stats.totalMessages, ""],
        ["statsRooms", "text-slate-300", stats.totalRooms, ""],
      ]
    : [];

  return (
    <div className="flex flex-col items-center gap-3">
      <span
        className={`inline-flex items-center gap-2 rounded-full bg-slate-900/60 px-3 py-1 text-[11px] font-medium text-slate-300 ring-1 ring-inset ${ring}`}
      >
        <span className="relative flex h-2 w-2">
          {state === "up" && (
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dot} opacity-75`}
            />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
        </span>
        {label}
      </span>
      {counters.some(([, , n]) => n > 0) && (
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs text-slate-400">
          {counters
            .filter(([, , n]) => n > 0)
            .map(([key, color, n]) => {
              const text = t(
                key as "statsWaiting" | "statsActive" | "statsMessages" | "statsRooms",
                { n: "\u0000" },
              );
              const [before, after] = text.split("\u0000");
              return (
                <span key={key}>
                  {before}
                  <span className={`font-semibold ${color}`}>
                    {n.toLocaleString()}
                  </span>
                  {after}
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}
