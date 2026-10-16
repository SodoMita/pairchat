"use client";

import { useEffect, useState } from "react";

type Stats = {
  waiting: number;
  activeChats: number;
  totalMessages: number;
  totalRooms: number;
};

/**
 * Live queue/chat stats for the landing page. Polls /api/stats every 10s
 * so visitors know how busy the service is before entering.
 */
export function QueueStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (res.ok && !cancelled) {
          setStats((await res.json()) as Stats);
        }
      } catch {
        /* ignore */
      }
    }
    void poll();
    const id = setInterval(poll, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!stats) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs text-slate-400">
      {stats.waiting > 0 && (
        <span>
          <span className="font-semibold text-indigo-300">{stats.waiting}</span>{" "}
          {stats.waiting === 1 ? "person" : "people"} waiting
        </span>
      )}
      {stats.activeChats > 0 && (
        <span>
          <span className="font-semibold text-emerald-300">
            {stats.activeChats}
          </span>{" "}
          {stats.activeChats === 1 ? "active chat" : "active chats"}
        </span>
      )}
      {stats.totalMessages > 0 && (
        <span>
          <span className="font-medium text-slate-300">
            {stats.totalMessages.toLocaleString()}
          </span>{" "}
          messages sent
        </span>
      )}
      {stats.totalRooms > 0 && (
        <span>
          <span className="font-medium text-slate-300">
            {stats.totalRooms.toLocaleString()}
          </span>{" "}
          rooms created
        </span>
      )}
    </div>
  );
}