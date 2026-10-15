"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "./I18nProvider";
import {
  clearRememberedRooms,
  forgetRoom,
  listRememberedRooms,
  type RememberedRoom,
} from "@/app/local/_lib/rememberRooms";

type Props = {
  activeId?: string | null;
};

/**
 * Left sidebar history column, modelled on AI-chat UIs (ChatGPT,
 * Mistral, Claude). Shows every room that's been opened in this browser,
 * with the most recent first. Active chat is highlighted.
 */
export function ChatHistory({ activeId }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<RememberedRoom[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setItems(listRememberedRooms());
    const onUpdate = () => setItems(listRememberedRooms());
    window.addEventListener("chatterbox:history-updated", onUpdate);
    return () =>
      window.removeEventListener("chatterbox:history-updated", onUpdate);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((r) =>
      `${r.title} ${r.preview ?? ""} ${r.id}`.toLowerCase().includes(q),
    );
  }, [items, query]);

  const grouped = useMemo(() => groupByRecency(filtered), [filtered]);

  return (
    <aside className="flex h-full w-full flex-col bg-slate-950 text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-bold">
            ✦
          </div>
          <span className="text-sm font-semibold tracking-tight">
            {t("appName")}
          </span>
        </div>
        <Link
          href="/"
          className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          title={t("backHome")}
        >
          ✕
        </Link>
      </div>

      <div className="px-3 pt-3">
        <Link
          href="/"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:from-indigo-400 hover:to-fuchsia-400"
        >
          <span aria-hidden>＋</span>
          {t("newChat")}
        </Link>
      </div>

      <div className="px-3 pt-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("historySearchPlaceholder")}
          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-slate-500">
            {query ? t("historyNoMatches") : t("historyEmpty")}
          </p>
        ) : (
          grouped.map((group) => (
            <div key={group.label} className="mb-4">
              <h3 className="px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {group.label}
              </h3>
              <ul className="mt-1 space-y-0.5">
                {group.items.map((r) => (
                  <HistoryRow
                    key={r.id}
                    item={r}
                    active={r.id === activeId}
                    onForget={(id) => {
                      forgetRoom(id);
                      setItems(listRememberedRooms());
                      if (r.id === activeId) router.push("/");
                    }}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </nav>

      {items.length > 0 && (
        <div className="border-t border-slate-800 px-3 py-2">
          <button
            type="button"
            onClick={() => {
              if (!confirm(t("historyClearConfirm"))) return;
              clearRememberedRooms();
              setItems([]);
              router.push("/");
            }}
            className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-800 hover:text-rose-300"
          >
            {t("historyClearAll")}
          </button>
        </div>
      )}
    </aside>
  );
}

function HistoryRow({
  item,
  active,
  onForget,
}: {
  item: RememberedRoom;
  active: boolean;
  onForget: (id: string) => void;
}) {
  const { t } = useI18n();
  const href = hrefFor(item);
  const kindLabel =
    item.kind === "local"
      ? t("localChatPresenceOnly")
      : item.kind === "room"
        ? t("rejoinRoom")
        : t("rejoinStranger");

  return (
    <li className="group relative">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`block rounded-lg px-3 py-2 transition ${
          active
            ? "bg-indigo-500/15 ring-1 ring-indigo-500/30"
            : "hover:bg-slate-900"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={`truncate text-sm font-medium ${
              active ? "text-indigo-100" : "text-slate-200"
            }`}
          >
            {item.title || kindLabel}
          </span>
          {item.active && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
              <span className="h-1 w-1 rounded-full bg-current" />
              live
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
          <span className="truncate">
            {item.preview
              ? `${item.previewFrom ? `${item.previewFrom}: ` : ""}${item.preview}`
              : kindLabel}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-500">
          <span>{relativeTime(item.ts, t)}</span>
          {item.unread ? (
            <span className="rounded-full bg-rose-500 px-1.5 py-0 text-[9px] font-semibold text-white">
              {item.unread}
            </span>
          ) : null}
        </div>
      </Link>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onForget(item.id);
        }}
        aria-label={t("historyForgetOne")}
        title={t("historyForgetOne")}
        className="absolute right-2 top-2 hidden rounded-md px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-800 hover:text-rose-300 group-hover:block"
      >
        ✕
      </button>
    </li>
  );
}

function hrefFor(item: RememberedRoom): string {
  if (item.kind === "local") return `/local/${encodeURIComponent(item.id)}`;
  if (item.kind === "stranger") {
    const sessionId = item.id.replace(/^stranger:/, "");
    return `/chat/stranger`;
  }
  const roomId = item.id.replace(/^room:/, "");
  return item.key
    ? `/room/${roomId}#${encodeURIComponent(item.key)}`
    : `/room/${roomId}`;
}

type Group = { label: string; items: RememberedRoom[] };

function groupByRecency(items: RememberedRoom[]): Group[] {
  const now = Date.now();
  const buckets: Record<string, RememberedRoom[]> = {
    today: [],
    yesterday: [],
    lastWeek: [],
    older: [],
  };
  for (const r of items) {
    const ageMs = now - r.ts;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageMs < 24 * 60 * 60 * 1000) buckets.today.push(r);
    else if (ageDays < 2) buckets.yesterday.push(r);
    else if (ageDays < 7) buckets.lastWeek.push(r);
    else buckets.older.push(r);
  }
  const out: Group[] = [];
  if (buckets.today.length) out.push({ label: "Today", items: buckets.today });
  if (buckets.yesterday.length)
    out.push({ label: "Yesterday", items: buckets.yesterday });
  if (buckets.lastWeek.length)
    out.push({ label: "Previous 7 days", items: buckets.lastWeek });
  if (buckets.older.length) out.push({ label: "Older", items: buckets.older });
  return out;
}

type TT = (k: import("@/lib/i18n/messages").MessageKey, vars?: Record<string, string>) => string;

function relativeTime(ts: number, t: TT): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return t("historyJustNow");
  if (diff < 60 * 60_000) {
    const m = Math.floor(diff / 60_000);
    return t("historyMinutesAgo", { n: String(m) });
  }
  if (diff < 24 * 60 * 60_000) {
    const h = Math.floor(diff / (60 * 60_000));
    return t("historyHoursAgo", { n: String(h) });
  }
  return new Date(ts).toLocaleDateString();
}