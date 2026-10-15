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
const LOCALE_COOKIE = "roulette_locale";

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

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: LocaleCode;
}) {
  const [locale, setLocaleState] = useState<LocaleCode>(
    initialLocale ?? DEFAULT_LOCALE,
  );

  // Hydrate from localStorage / navigator on the client.
  useEffect(() => {
    if (initialLocale) return;
    const detected = readInitialLocale();
    if (detected !== locale) setLocaleState(detected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dir = getDirForLocale(locale);

  // Reflect locale in <html lang/dir> and persist to storage.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore
    }
    // Non-HttpOnly cookie so server components can read it (for SSR).
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, [locale, dir]);

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