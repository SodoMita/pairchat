"use client";

import { useState } from "react";
import { ChatHistory } from "./ChatHistory";
import { LanguagePicker } from "./LanguagePicker";
import { useI18n } from "./I18nProvider";

/**
 * Two-column shell used by all chat pages: left sidebar shows the
 * chat history column, right is the active chat. On mobile, the
 * sidebar collapses into a drawer.
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

  return (
    <div className="grid h-screen grid-cols-1 bg-slate-950 text-slate-100 lg:grid-cols-[320px_1fr]">
      {/* Sidebar — always visible on lg+. Drawer on smaller screens. */}
      <div
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