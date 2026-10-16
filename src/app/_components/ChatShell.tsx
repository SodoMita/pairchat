"use client";

import { useEffect, useRef, useState } from "react";
import { ChatHistory } from "./ChatHistory";
import { LanguagePicker } from "./LanguagePicker";
import { useI18n } from "./I18nProvider";

/**
 * Two-column shell used by all chat pages: left sidebar shows the
 * chat history column, right is the active chat. On mobile, the
 * sidebar collapses into a drawer with ESC handling and focus trap.
 */
export function ChatShell({
  activeId,
  children,
}: {
  activeId: string | null;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close drawer on ESC and trap focus inside the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      // Simple focus trap: if user tabs while focused outside drawer, move back in.
      if (e.key === "Tab" && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    // Focus first link/button in the drawer when it opens.
    drawerRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled])',
    )?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="grid h-screen grid-cols-1 bg-slate-950 text-slate-100 lg:grid-cols-[320px_1fr]">
      {/* Sidebar — always visible on lg+. Drawer on smaller screens. */}
      <div
        ref={drawerRef}
        role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen ? true : undefined}
        aria-label={drawerOpen ? t("history") : undefined}
        className={`fixed inset-y-0 left-0 z-40 w-72 transform border-r border-slate-800 bg-slate-950 transition-transform lg:static lg:w-auto lg:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <ChatHistory activeId={activeId} />
      </div>

      {/* Backdrop on mobile when drawer is open. */}
      {drawerOpen && (
        <button
          type="button"
          aria-label={t("backHome")}
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      )}

      <div className="relative flex h-screen flex-col overflow-hidden">
        {/* Mobile top bar — drawer toggle + language picker */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-2 lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200"
            aria-label={t("history")}
            aria-expanded={drawerOpen}
          >
            ☰ {t("history")}
          </button>
          <LanguagePicker compact />
        </div>

        {children}
      </div>
    </div>
  );
}