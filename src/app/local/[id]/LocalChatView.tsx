"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/app/_components/I18nProvider";
import { LanguagePicker } from "@/app/_components/LanguagePicker";
import { ConfirmDialog } from "@/app/_components/ConfirmDialog";
import { ChatShell } from "@/app/_components/ChatShell";
import { useLocalChat } from "../_lib/useLocalChat";

type LocalMsg = {
  id: string;
  tabId: string;
  senderName: string;
  body: string;
  ts: number;
};

export default function LocalChatPage() {
  const params = useParams<{ id: string }>();
  const roomId = typeof params.id === "string" ? params.id : "";
  return <LocalChatShell roomId={roomId} />;
}

function LocalChatShell({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const chat = useLocalChat(roomId);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (chat.self) setNameDraft(chat.self.name);
  }, [chat.self]);

  // Scroll on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat.messages.length]);

  // Auto-focus on mount and after send.
  useEffect(() => {
    inputRef.current?.focus();
  }, [roomId]);

  const doSend = useCallback(() => {
    if (!draft.trim()) return;
    chat.send(draft);
    setDraft("");
    inputRef.current?.focus();
  }, [draft, chat]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  // Capture printable keys when nothing is focused.
  useEffect(() => {
    function isEditable(el: Element | null): boolean {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    }
    function onKey(e: KeyboardEvent) {
      if (chat.roomFull) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      if (!/[\p{L}\p{N}\p{P}\p{S}\s]/u.test(e.key)) return;
      if (isEditable(document.activeElement)) return;
      const dlg = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (dlg) return;
      e.preventDefault();
      inputRef.current?.focus();
      setDraft((p) => p + e.key);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chat.roomFull]);

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/local/${encodeURIComponent(roomId)}`
      : `/local/${encodeURIComponent(roomId)}`;

  const tabCount = Math.max(1, chat.liveCount);

  return (
    <ChatShell activeId={roomId}>
      <div className="flex h-full flex-col bg-slate-950 text-slate-100">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <a
              href="/"
              className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-lg font-bold"
            >
            ⚘
          </a>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold">
                {t("localChatTitle")}
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {t("localChatPresenceOnly")}
              </span>
            </div>
            <p className="truncate text-xs text-slate-400">
              {t("localChatTabCount", { n: String(tabCount) })}
              {" · "}
              key: <span className="font-mono text-slate-300">{roomId}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LanguagePicker compact />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shareUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // ignore
              }
            }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
          >
            {copied ? t("copiedLink") : t("copyLink")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="rounded-lg border border-amber-700/60 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-500/20"
            title={t("localChatClearHistory")}
          >
            {t("localChatClearHistory")}
          </button>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
          >
            {t("localChatLeave")}
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {chat.messages.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
              {chat.roomFull ? t("localChatRoomFull") : t("localChatEmpty")}
            </div>
          )}
          {chat.messages.map((m: LocalMsg) => {
            const mine = chat.self?.tabId === m.tabId;
            return (
              <div
                key={m.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm sm:max-w-[70%] ${
                    mine
                      ? "rounded-br-md bg-gradient-to-br from-emerald-500 to-teal-500 text-white"
                      : "rounded-bl-md bg-slate-800 text-slate-100"
                  }`}
                >
                  {!mine && (
                    <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {m.senderName}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div
                    className={`mt-1 text-[10px] ${mine ? "text-emerald-100/70" : "text-slate-500"}`}
                  >
                    {new Date(m.ts).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-800 bg-slate-900/60 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <div className="flex items-center gap-2">
            {editingName ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  chat.renameSelf(nameDraft);
                  setEditingName(false);
                }}
                className="flex flex-1 items-center gap-2"
              >
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder={t("anonymous")}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                  autoFocus
                />
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400"
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={() => setEditingName(false)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                >
                  ✕
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="text-xs text-slate-400 hover:text-slate-200"
                title="Rename"
              >
                {t("youAre")}{" "}
                <span className="rounded-full bg-slate-800 px-2 py-0.5 font-medium text-slate-100">
                  {chat.self?.name ?? t("anonymous")}
                </span>
              </button>
            )}
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              doSend();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                chat.roomFull
                  ? t("localChatRoomFull")
                  : t("inputPlaceholder")
              }
              disabled={chat.roomFull}
              maxLength={2000}
              className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={chat.roomFull || !draft.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:from-emerald-400 hover:to-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("sendBtn")}
            </button>
          </form>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title={t("localChatConfirmClearTitle")}
        description={t("localChatConfirmClearBody")}
        confirmLabel={t("localChatConfirmClearConfirm")}
        cancelLabel={t("localChatConfirmClearCancel")}
        destructive
        onConfirm={() => {
          chat.clearHistory();
          setConfirmClear(false);
        }}
        onCancel={() => setConfirmClear(false)}
      />
      </div>
    </ChatShell>
  );
}