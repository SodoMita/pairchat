"use client";

import Link from "next/link";
import { useI18n } from "./I18nProvider";
import { TopBar } from "./TopBar";
import { LanguagePicker } from "./LanguagePicker";
import { CreateRoomButton } from "./CreateRoomButton";
import { ServiceStatus } from "./ServiceStatus";
import { ChatHistory } from "./ChatHistory";

export function HomeView() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-screen grid-cols-1 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 lg:grid-cols-[320px_1fr]">
      {/* Left: chat history sidebar (visible on lg+) */}
      <div className="hidden border-r border-slate-800 bg-slate-950 lg:block">
        <ChatHistory activeId={null} />
      </div>

      {/* Right: main landing content */}
      <main className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-6 py-6 sm:px-10">
          <Link href="/" className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-lg font-bold">
              ✦
            </div>
            <span className="text-lg font-semibold tracking-tight">
              {t("appName")}
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <TopBar />
            <LanguagePicker />
          </div>
        </header>

        {/* Mobile-only history preview (collapsed). */}
        <div className="border-b border-slate-800 px-6 sm:px-10 lg:hidden">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm text-slate-300">
              <span className="flex items-center gap-2">
                <span aria-hidden>☰</span>
                {t("history")}
              </span>
              <span className="text-xs text-slate-500 group-open:hidden">
                show
              </span>
              <span className="text-xs text-slate-500 hidden group-open:inline">
                hide
              </span>
            </summary>
            <div className="pb-4">
              <ChatHistory activeId={null} />
            </div>
          </details>
        </div>

        <section className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:px-10">
          <div className="mb-3 flex justify-center">
            <ServiceStatus />
          </div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
            {t("tagline")}
          </p>
          <h1 className="max-w-3xl text-balance text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            {t("heroTitle1")}
            <br />
            <span className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-rose-300 bg-clip-text text-transparent">
              {t("heroTitle2")}
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-base text-slate-300 sm:text-lg">
            {t("heroBody")}
          </p>

          <div className="mt-10 grid w-full max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href="/chat/stranger"
              className="group relative overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6 text-left transition hover:border-indigo-400/60 hover:bg-slate-900"
            >
              <div className="absolute -right-10 -bottom-10 h-40 w-40 rounded-full bg-indigo-500/20 transition group-hover:bg-indigo-500/30" />
              <div className="relative">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 text-xl">
                  🎲
                </div>
                <h2 className="text-xl font-semibold">{t("strangerTitle")}</h2>
                <p className="mt-2 text-sm text-slate-300">
                  {t("strangerBody")}
                </p>
                <p className="mt-4 text-sm font-medium text-indigo-300">
                  {t("strangerCta")}
                </p>
              </div>
            </Link>

            <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6 text-left">
              <div className="absolute -right-10 -bottom-10 h-40 w-40 rounded-full bg-fuchsia-500/20" />
              <div className="relative">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-500/20 text-xl">
                  🔗
                </div>
                <h2 className="text-xl font-semibold">{t("roomTitle")}</h2>
                <p className="mt-2 text-sm text-slate-300">
                  {t("roomBody")}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <CreateRoomButton />
                </div>
                <div className="mt-4">
                  <Link
                    href="/join"
                    className="text-sm font-medium text-fuchsia-300 hover:underline"
                  >
                    {t("joinRoomLink")}
                  </Link>
                </div>
              </div>
            </div>

            <Link
              href="/local"
              className="group relative overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6 text-left transition hover:border-emerald-400/60 hover:bg-slate-900"
            >
              <div className="absolute -right-10 -bottom-10 h-40 w-40 rounded-full bg-emerald-500/20 transition group-hover:bg-emerald-500/30" />
              <div className="relative">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-xl">
                  ⚘
                </div>
                <h2 className="text-xl font-semibold">{t("localChatTitle")}</h2>
                <p className="mt-2 text-sm text-slate-300">
                  {t("localChatBody")}
                </p>
                <p className="mt-4 text-sm font-medium text-emerald-300">
                  {t("localChatCta")}
                </p>
              </div>
            </Link>
          </div>
        </section>

        <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
          {t("footerNote")}
        </footer>
      </main>
    </div>
  );
}