import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import "./globals.css";
import { I18nProvider } from "./_components/I18nProvider";
import { NotificationCount } from "./_components/NotificationCount";
import { NotificationSound } from "./_components/NotificationSound";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type LocaleCode,
} from "@/lib/i18n/messages";

export const metadata: Metadata = {
  title: "Chatterbox — Chat roulette & private rooms",
  description:
    "Text-first chat roulette. Pair with a random stranger, or spin up a private room and share a link.",
};

const LOCALE_COOKIE = "roulette_locale";

async function detectLocaleFromCookies(): Promise<LocaleCode> {
  const jar = await cookies();
  const raw = jar.get(LOCALE_COOKIE)?.value;
  if (!raw) return DEFAULT_LOCALE;
  const found = SUPPORTED_LOCALES.find((l) => l.code === raw);
  return found ? found.code : DEFAULT_LOCALE;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await detectLocaleFromCookies();
  return (
    <html lang={locale}>
      <body className="bg-slate-950 text-slate-100 antialiased">
        <I18nProvider initialLocale={locale}>
          <NotificationCount />
          <NotificationSound />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}