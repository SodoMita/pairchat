"use client";

import Link from "next/link";
import { useI18n } from "@/app/_components/I18nProvider";
import { LanguagePicker } from "@/app/_components/LanguagePicker";
import { JoinForm } from "./JoinForm";

export function JoinView() {
  const { t } = useI18n();
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
      <div className="absolute end-4 top-4">
        <LanguagePicker />
      </div>
      <div className="w-full max-w-md">
        <Link prefetch={false}
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-fuchsia-300 hover:underline"
        >
          {t("backHome")}
        </Link>
        <h1 className="text-3xl font-bold sm:text-4xl">{t("joinTitle")}</h1>
        <p className="mt-2 text-sm text-slate-400">{t("joinBody")}</p>
        <div className="mt-8">
          <JoinForm />
        </div>
      </div>
    </main>
  );
}