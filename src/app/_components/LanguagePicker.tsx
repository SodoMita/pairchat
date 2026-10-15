"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "./I18nProvider";

export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, locales, t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = locales.find((l) => l.code === locale) ?? locales[0];

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={
          compact
            ? "inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
            : "inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
        }
        title={t("languageLabel")}
      >
        <span aria-hidden className="text-base leading-none">
          🌐
        </span>
        {!compact && (
          <span className="hidden sm:inline">{current.native}</span>
        )}
        <span className={compact ? "" : "sm:hidden"}>
          {current.code.toUpperCase()}
        </span>
        <span aria-hidden className="text-[10px] opacity-70">▾</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full z-40 mt-2 max-h-80 w-64 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 p-1 shadow-2xl backdrop-blur"
        >
          {locales.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                role="option"
                aria-selected={l.code === locale}
                onClick={() => {
                  setLocale(l.code);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                  l.code === locale
                      ? "bg-indigo-500/20 text-indigo-100"
                      : "text-slate-200 hover:bg-slate-800"
                }`}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{l.native}</span>
                  <span className="text-[11px] text-slate-400">{l.label}</span>
                </span>
                {l.code === locale && (
                  <span aria-hidden className="text-indigo-300">
                    ✓
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}