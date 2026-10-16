"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "./I18nProvider";
import { ConfirmDialog, type ConfirmDescriptor } from "./ConfirmDialog";
import { LanguagePicker } from "./LanguagePicker";
import { updatePreview } from "@/app/local/_lib/touchPreview";

type ChatMessage = {
  id: string;
  scope: string;
  senderUserId: string;
  senderName: string;
  body: string;
  createdAt: string;
  systemFlag: boolean;
};

type ChatWindowProps = {
  initialMessages: ChatMessage[];
  /** Parent-owned decrypted history, when the chat is end-to-end encrypted. */
  externalMessages?: ChatMessage[];
  /** Disable the built-in plaintext SSE listener when a parent decrypts SSE. */
  manageSSE?: boolean;
  selfUserId: string;
  selfName: string;
  apiBase: string;
  /** Stable id used to update the history sidebar (e.g. "stranger:<id>" or "room:<id>"). */
  historyId?: string;
  partnerName?: string | null;
  partnerLabel?: string;
  title: string;
  subtitle?: string;
  shareUrl?: string;
  status?: { kind: "ok" | "warn" | "danger"; text: string };
  onEnded?: () => void;
  headerRight?: React.ReactNode;
  /**
   * Called when the user requests to skip to the next stranger. The
   * parent should perform the actual matchmaking teardown.
   */
  onNext?: () => void;
  /**
   * Called when the user clicks "Close room". The parent should perform
   * the room close API call.
   */
  onCloseRoom?: () => void;
  /**
   * Called when the user clicks "Leave". The parent should navigate away
   * and clean up. The button is rendered internally so the dialog flows
   * are consistent.
   */
  onLeave?: () => void;
  /** Render a custom "leave" button (e.g., for guest view). */
  customLeaveLabel?: string;
  disabled?: boolean;
  placeholder?: string;
  /**
   * If provided, called with plaintext instead of issuing the default
   * plaintext POST. The parent is responsible for encrypting before
   * talking to the server. Used for end-to-end encrypted chats.
   */
  customSend?: (plaintext: string) => Promise<void>;
  /** Show an "Encrypted" badge in the header. */
  encrypted?: boolean;
};

type PendingConfirm =
  | { kind: "leave" }
  | { kind: "next" }
  | { kind: "closeRoom" };

export function ChatWindow({
  initialMessages,
  externalMessages,
  manageSSE = true,
  selfUserId,
  selfName,
  apiBase,
  historyId,
  partnerName,
  partnerLabel: partnerLabelProp,
  title,
  subtitle: subtitleProp,
  shareUrl,
  status,
  onEnded,
  headerRight,
  onNext,
  onCloseRoom,
  onLeave,
  customLeaveLabel,
  disabled,
  placeholder: placeholderProp,
  customSend,
  encrypted,
}: ChatWindowProps) {
  const { t } = useI18n();
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>(initialMessages);
  const messages = externalMessages ?? localMessages;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastTimestampRef = useRef<string | null>(
    initialMessages[initialMessages.length - 1]?.createdAt ?? null,
  );

  // Localized labels
  const partnerLabel = partnerLabelProp ?? t("partnerLabel");
  const placeholder =
    placeholderProp ?? (disabled ? t("emptyWaiting") : t("inputPlaceholder"));
  const subtitle = subtitleProp ?? t("chatSubtitle");

  const unreadRef = useRef(0);

  const appendMessage = useCallback((m: ChatMessage) => {
    setLocalMessages((prev) => {
      if (prev.some((p) => p.id === m.id)) return prev;
      return [...prev, m];
    });
    if (m.createdAt) lastTimestampRef.current = m.createdAt;
    // Push the new message into the chat-history preview bucket so the
    // sidebar shows the most-recent message per room. Skip system
    // messages (partner left etc.) — those shouldn't dominate the row.
    if (!m.systemFlag && historyId) {
      updatePreview(
        historyId,
        m.body,
        m.senderUserId === selfUserId ? selfName : (m.senderName || ""),
        Date.parse(m.createdAt) || Date.now(),
      );
    }
    // #11: When the tab is not focused and a real message arrives from
    // a different sender, bump the unread badge in the tab title.
    if (
      !m.systemFlag &&
      m.senderUserId !== selfUserId &&
      typeof document !== "undefined" &&
      document.hidden
    ) {
      unreadRef.current += 1;
      window.dispatchEvent(
        new CustomEvent("chatterbox:unread-set", {
          detail: { count: unreadRef.current },
        }),
      );
      // #10 + #15: fire the sound + browser notification event.
      window.dispatchEvent(
        new CustomEvent("chatterbox:incoming-message", {
          detail: { senderName: m.senderName, body: m.body },
        }),
      );
    }
  }, [historyId, selfUserId, selfName]);

  // SSE subscription. Encrypted chat parents own this subscription and
  // pass already-decrypted `externalMessages` so no ciphertext is ever
  // rendered as plaintext or parsed by this component.
  useEffect(() => {
    if (!manageSSE) return;
    let es: EventSource | null = null;

    const since = lastTimestampRef.current;
    const url = since
      ? `${apiBase}${apiBase.includes("?") ? "&" : "?"}since=${encodeURIComponent(since)}`
      : apiBase;

    es = new EventSource(url);

    es.addEventListener("message", (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as {
          type: string;
          message?: ChatMessage;
        };
        if (payload.type === "message" && payload.message) {
          appendMessage(payload.message);
        }
      } catch {
        // ignore
      }
    });

    es.addEventListener("partner", (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as { type: string };
        if (payload.type === "partner_left") {
          appendMessage({
            id: `sys-partner-${Date.now()}`,
            scope: apiBase,
            senderUserId: "system",
            senderName: "System",
            body: t("partnerLeftMsg", { label: partnerLabel }),
            createdAt: new Date().toISOString(),
            systemFlag: true,
          });
          onEnded?.();
        }
      } catch {
        // ignore
      }
    });

    return () => {
      if (es) es.close();
    };
  }, [apiBase, appendMessage, manageSSE, onEnded, partnerLabel, t]);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Reset unread counter when tab becomes visible again.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) {
        unreadRef.current = 0;
        window.dispatchEvent(
          new CustomEvent("chatterbox:unread-set", { detail: { count: 0 } }),
        );
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Auto-focus the composer on mount and after a successful send, so the
  // user never has to click into the input to start typing. Skipped while
  // a confirm dialog is open or the chat is disabled.
  useEffect(() => {
    if (disabled) return;
    inputRef.current?.focus();
  }, [disabled, selfUserId]);

  // Capture printable keys when nothing is focused so the first typed
  // character lands in the composer without a click. We bail out on
  // modifier shortcuts and when a non-text input already owns focus.
  useEffect(() => {
    function isEditable(el: Element | null): boolean {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (disabled) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return; // skip arrows, Enter, etc.
      if (e.key === " " || /[\p{L}\p{N}\p{P}\p{S}]/u.test(e.key) === false) return;
      if (isEditable(document.activeElement)) return;
      // Don't hijack while a confirm dialog is open.
      const dlg = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (dlg) return;
      e.preventDefault();
      inputRef.current?.focus();
      setDraft((prev) => prev + e.key);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || disabled) return;
    setSending(true);
    try {
      if (customSend) {
        // The parent owns encryption. We don't add to the local message
        // list here because the parent appends optimistically.
        await customSend(text);
        setDraft("");
        inputRef.current?.focus();
        return;
      }
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("Send failed");
      const data = (await res.json()) as { message: ChatMessage };
      appendMessage(data.message);
      setDraft("");
      inputRef.current?.focus();
    } catch {
      appendMessage({
        id: `sys-err-${Date.now()}`,
        scope: apiBase,
        senderUserId: "system",
        senderName: "System",
        body: t("sendFailed"),
        createdAt: new Date().toISOString(),
        systemFlag: true,
      });
    } finally {
      setSending(false);
    }
  }, [apiBase, appendMessage, customSend, disabled, draft, t]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const statusColor = useMemo(() => {
    if (!status) return "";
    switch (status.kind) {
      case "ok":
        return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
      case "warn":
        return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
      case "danger":
        return "bg-rose-500/15 text-rose-300 ring-rose-500/30";
    }
  }, [status]);

  // Confirmation flows — clicking the button stages the confirm; the
  // confirm dialog calls the actual action via `onConfirm`.
  const confirmDescriptor: ConfirmDescriptor | null = pendingConfirm
    ? pendingConfirm.kind === "leave"
      ? {
          title: t("confirmLeaveTitle"),
          description: t("confirmLeaveBody"),
          confirmLabel: t("confirmLeaveConfirm"),
          cancelLabel: t("confirmLeaveCancel"),
          destructive: true,
        }
      : pendingConfirm.kind === "next"
      ? {
          title: t("confirmNextTitle"),
          description: t("confirmNextBody"),
          confirmLabel: t("confirmNextConfirm"),
          cancelLabel: t("confirmNextCancel"),
          destructive: false,
        }
      : {
          title: t("confirmCloseRoomTitle"),
          description: t("confirmCloseRoomBody"),
          confirmLabel: t("confirmCloseRoomConfirm"),
          cancelLabel: t("confirmCloseRoomCancel"),
          destructive: true,
        }
    : null;

  const runPending = useCallback(() => {
    const p = pendingConfirm;
    setPendingConfirm(null);
    if (!p) return;
    if (p.kind === "leave") onLeave?.();
    if (p.kind === "next") onNext?.();
    if (p.kind === "closeRoom") onCloseRoom?.();
  }, [pendingConfirm, onLeave, onNext, onCloseRoom]);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <a
            href="/"
            className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-lg font-bold"
          >
            ✦
          </a>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold">{title}</h1>
              {encrypted && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
                  title={t("encryptedBadge")}
                >
                  <span aria-hidden>🔒</span>
                  {t("encryptedBadge")}
                </span>
              )}
              {status && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusColor}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {status.text}
                </span>
              )}
            </div>
            <p className="truncate text-xs text-slate-400">
              {subtitle}
              {partnerName && (
                <span className="ms-2 text-slate-500">· {partnerName}</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Compact language picker inside the chat, so users can switch
              mid-conversation without leaving the page. */}
          <LanguagePicker compact />
          {shareUrl && (
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
          )}
          {onNext && (
            <button
              type="button"
              onClick={() => setPendingConfirm({ kind: "next" })}
              className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow shadow-indigo-500/30 transition hover:bg-indigo-400"
            >
              {t("nextBtn")}
            </button>
          )}
          {onCloseRoom && (
            <button
              type="button"
              onClick={() => setPendingConfirm({ kind: "closeRoom" })}
              className="rounded-lg border border-rose-700/60 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
            >
              {t("closeRoom")}
            </button>
          )}
          {onLeave && (
            <button
              type="button"
              onClick={() => setPendingConfirm({ kind: "leave" })}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
            >
              {customLeaveLabel ?? t("leaveBtn")}
            </button>
          )}
          {headerRight}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t("chatTitleDefault")}
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
              {disabled ? t("emptyWaiting") : t("emptyIce")}
            </div>
          )}
          {messages.map((m) => {
            if (m.systemFlag) {
              return (
                <div
                  key={m.id}
                  className="self-center rounded-full bg-slate-800/60 px-3 py-1 text-center text-xs text-slate-400"
                >
                  {m.body}
                </div>
              );
            }
            const mine = m.senderUserId === selfUserId;
            return (
              <div
                key={m.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm sm:max-w-[70%] ${
                    mine
                      ? "rounded-br-md bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"
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
                    className={`mt-1 text-[10px] ${mine ? "text-indigo-100/70" : "text-slate-500"}`}
                  >
                    {new Date(m.createdAt).toLocaleTimeString([], {
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
        <form
          className="mx-auto flex max-w-2xl items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor="chat-input" className="sr-only">
            {t("inputPlaceholder")}
          </label>
          <input
            id="chat-input"
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={disabled || sending}
            maxLength={2000}
            aria-label={t("inputPlaceholder")}
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={disabled || sending || !draft.trim()}
            aria-label={t("sendBtn")}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:from-indigo-400 hover:to-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? t("sendingBtn") : t("sendBtn")}
          </button>
        </form>
        <p className="mx-auto mt-1.5 max-w-2xl text-center text-[10px] text-slate-500">
          {t("beRespectful", { name: selfName })}
        </p>
      </div>

      <ConfirmDialog
        open={!!confirmDescriptor}
        title={confirmDescriptor?.title ?? ""}
        description={confirmDescriptor?.description}
        confirmLabel={confirmDescriptor?.confirmLabel ?? ""}
        cancelLabel={confirmDescriptor?.cancelLabel ?? ""}
        destructive={confirmDescriptor?.destructive}
        onConfirm={runPending}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}