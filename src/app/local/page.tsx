"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/app/_components/I18nProvider";
import { LanguagePicker } from "@/app/_components/LanguagePicker";

const REMEMBERED_KEY = "chatterbox.local.rooms";

function generateKey(): string {
  // 6-char key like "k7q2xb". Lowercase letters and digits, no look-alikes.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function readRememberedRooms(): Array<{
  id: string;
  kind: "stranger" | "room" | "local";
  ts: number;
}> {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(REMEMBERED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<
      string,
      { kind: string; ts: number }
    >;
    return Object.entries(parsed)
      .map(([id, v]) => ({
        id,
        kind: v.kind as "stranger" | "room" | "local",
        ts: v.ts,
      }))
      .sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

export default function LocalChatLanding() {
  const router = useRouter();
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const [rooms, setRooms] = useState<ReturnType<typeof readRememberedRooms>>([]);

  useEffect(() => {
    setRooms(readRememberedRooms());
    setKey(generateKey());
  }, []);

  function refresh() {
    setRooms(readRememberedRooms());
  }

  function openRoom(id: string) {
    if (!id.trim()) return;
    router.push(`/local/${encodeURIComponent(id.trim().toLowerCase())}`);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    openRoom(key);
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            {t("backHome")}
          </Link>
          <LanguagePicker />
        </header>

        <section className="mt-10">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-xl">
            ⚘
          </div>
          <h1 className="text-3xl font-bold sm:text-4xl">
            {t("localChatTitle")}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            {t("localChatBody")}
          </p>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6">
          <form
            onSubmit={onSubmit}
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
              placeholder={t("localChatJoinPlaceholder")}
              maxLength={32}
              className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base font-mono text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setKey(generateKey())}
              className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200 transition hover:bg-slate-700"
            >
              {t("localChatNewId")}
            </button>
            <button
              type="submit"
              disabled={!key.trim()}
              className="rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:from-emerald-400 hover:to-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("localChatJoinSubmit")}
            </button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Tip: open this page in two tabs with the same key to chat.
          </p>
        </section>

        {rooms.length > 0 && (
          <section className="mt-8 rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
              {t("history")}
            </h2>
            <ul className="mt-3 divide-y divide-slate-800">
              {rooms.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-slate-200">
                      {r.id}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.kind === "local"
                        ? t("localChatPresenceOnly")
                        : r.kind === "room"
                          ? t("rejoinRoom")
                          : t("rejoinStranger")}{" "}
                      ·{" "}
                      {new Date(r.ts).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openRoom(r.id)}
                    className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
                  >
                    {t("localChatCta").replace(" →", "")}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem(REMEMBERED_KEY);
                  } catch {
                    // ignore
                  }
                  refresh();
                }}
                className="text-xs text-slate-400 hover:text-rose-300"
              >
                Clear history
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}