"use client";

import Link from "next/link";
import { useI18n } from "./_components/I18nProvider";
import { LanguagePicker } from "./_components/LanguagePicker";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-6 text-slate-100">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 text-6xl">🤷</div>
        <h1 className="text-3xl font-bold">404</h1>
        <p className="mt-3 text-sm text-slate-400">
          This page doesn&rsquo;t exist or has expired.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/"
            className="rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:from-indigo-400 hover:to-fuchsia-400"
          >
            {t("backHomeBtn")}
          </Link>
        </div>
        <div className="mt-6">
          <LanguagePicker />
        </div>
      </div>
    </main>
  );
}