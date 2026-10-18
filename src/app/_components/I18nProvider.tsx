"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LOCALE,
  format,
  getLocaleMessages,
  pickLocaleFromNavigator,
  SUPPORTED_LOCALES,
  type LocaleCode,
  type MessageKey,
  type Messages,
} from "@/lib/i18n/messages";

const LOCALE_STORAGE_KEY = "chatterbox.locale";

type Direction = "ltr" | "rtl";

type I18nContextValue = {
  locale: LocaleCode;
  setLocale: (code: LocaleCode) => void;
  t: (key: MessageKey, vars?: Record<string, string>) => string;
  messages: Messages;
  locales: typeof SUPPORTED_LOCALES;
  dir: Direction;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readInitialLocale(): LocaleCode {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  // Prefer localStorage if user explicitly chose one.
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) {
      const found = SUPPORTED_LOCALES.find((l) => l.code === stored);
      if (found) return found.code;
    }
  } catch {
    // ignore
  }
  // Fall back to navigator language, then default.
  return pickLocaleFromNavigator(window.navigator?.language);
}

function getDirForLocale(code: LocaleCode): Direction {
  const loc = SUPPORTED_LOCALES.find((l) => l.code === code);
  return loc && "rtl" in loc && loc.rtl ? "rtl" : "ltr";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Pages are statically rendered in the default locale; the visitor's
  // locale is detected on the client (no cookie, so nothing here forces
  // per-request server rendering and no extra cookie rides on every request).
  const [locale, setLocaleState] = useState<LocaleCode>(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLocaleState(readInitialLocale());
    setReady(true);
  }, []);

  const dir = getDirForLocale(locale);

  // Reflect locale in <html lang/dir> and persist the choice. Gated on
  // `ready` so the placeholder default never overwrites a saved locale.
  useEffect(() => {
    if (!ready || typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore
    }
    // Reveal the page (see the pre-paint guard in the root layout).
    document.documentElement.removeAttribute("data-i18n-pending");
  }, [ready, locale, dir]);

  const setLocale = useCallback((code: LocaleCode) => {
    setLocaleState(code);
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string>) => {
      const msg = getLocaleMessages(locale);
      const raw = msg[key] ?? getLocaleMessages(DEFAULT_LOCALE)[key] ?? key;
      return vars ? format(raw, vars) : raw;
    },
    [locale],
  );

  const messages = useMemo(() => getLocaleMessages(locale), [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      messages,
      locales: SUPPORTED_LOCALES,
      dir,
    }),
    [locale, setLocale, t, messages, dir],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside an <I18nProvider>");
  }
  return ctx;
}

export function useT() {
  return useI18n().t;
}