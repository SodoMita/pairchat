"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "./I18nProvider";
import { ConfirmDialog } from "./ConfirmDialog";
import { LanguagePicker } from "./LanguagePicker";
import { updatePreview } from "@/app/local/_lib/touchPreview";
import type { DisplayMessage } from "@/lib/protocol";

type Props = {
  initialMessages: DisplayMessage[]; externalMessages?: DisplayMessage[]; manageSSE?: boolean;
  selfUserId: string; selfName: string; apiBase: string; historyId?: string;
  partnerName?: string | null; partnerLabel?: string; title: string; subtitle?: string; shareUrl?: string;
  status?: { kind: "ok" | "warn" | "danger"; text: string }; onEnded?: () => void; headerRight?: React.ReactNode;
  onNext?: () => void | Promise<void>; onCloseRoom?: () => void | Promise<void>; onLeave?: () => void | Promise<void>;
  customLeaveLabel?: string; disabled?: boolean; placeholder?: string; customSend: (plaintext: string) => Promise<void>; encrypted?: boolean;
};
export function ChatWindow(props: Props) {
  const { t, locale } = useI18n();
  const messages = props.externalMessages ?? props.initialMessages;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<"leave" | "next" | "close" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const seen = useRef(new Set<string>());
  const mountedAt = useRef(Date.now());
  const unread = useRef(0);
  const id = useId();
  useEffect(() => {
    const last = messages.filter(m => !m.systemFlag).at(-1);
    if (last && props.historyId) updatePreview(props.historyId, last.body, last.senderName, Date.parse(last.createdAt));
    for (const m of messages) {
      if (seen.current.has(m.id)) continue;
      seen.current.add(m.id);
      if (!m.systemFlag && m.senderUserId !== props.selfUserId && Date.parse(m.createdAt) >= mountedAt.current && document.hidden) {
        unread.current++;
        window.dispatchEvent(new CustomEvent("chatterbox:unread-set", { detail: { count: unread.current } }));
        // Notification events deliberately omit names, message text and keys.
        window.dispatchEvent(new CustomEvent("chatterbox:incoming-message", { detail: { id: m.id } }));
      }
    }
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, props.historyId, props.selfUserId]);
  useEffect(() => {
    const clear = () => { if (!document.hidden) { unread.current = 0; window.dispatchEvent(new CustomEvent("chatterbox:unread-set", { detail: { count: 0 } })); } };
    window.addEventListener("focus", clear); document.addEventListener("visibilitychange", clear);
    return () => { window.removeEventListener("focus", clear); document.removeEventListener("visibilitychange", clear); };
  }, []);
  useEffect(() => { if (!props.disabled && !confirm) input.current?.focus(); }, [props.disabled, confirm]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (props.disabled || confirm || e.defaultPrevented || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
      const target = document.activeElement as HTMLElement | null;
      if (target?.closest("input,textarea,select,button,a,[contenteditable],[role='listbox'],[role='dialog'],summary") || document.querySelector("dialog[open], [aria-modal='true']")) return;
      e.preventDefault(); input.current?.focus(); setDraft(prev => (prev + e.key).slice(0, 2000));
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [props.disabled, confirm]);
  const send = async () => {
    const text = draft.trim();
    if (!text || props.disabled || sendingRef.current) return;
    sendingRef.current = true; setSending(true); setFailure(null);
    try {
      await props.customSend(text);
      setDraft(current => current.trim() === text ? "" : current);
    } catch (error) { setFailure(error instanceof Error ? error.message : t("sendFailed")); }
    finally { sendingRef.current = false; setSending(false); requestAnimationFrame(() => { if (!document.querySelector("dialog[open], [aria-modal='true']")) input.current?.focus(); }); }
  };
  const confirmKeys = confirm === "next"
    ? { title: t("confirmNextTitle"), description: t("confirmNextBody"), confirmLabel: t("confirmNextConfirm"), cancelLabel: t("confirmNextCancel") }
    : confirm === "close"
      ? { title: t("confirmCloseRoomTitle"), description: t("confirmCloseRoomBody"), confirmLabel: t("confirmCloseRoomConfirm"), cancelLabel: t("confirmCloseRoomCancel") }
      : { title: t("confirmLeaveTitle"), description: t("confirmLeaveBody"), confirmLabel: t("confirmLeaveConfirm"), cancelLabel: t("confirmLeaveCancel") };
  return <div className="flex min-h-0 flex-1 flex-col bg-slate-950 text-slate-100">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/60 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" prefetch={false} aria-label={t("backHomeBtn")} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500">✦</Link>
        <div className="min-w-0"><h1 className="truncate text-base font-semibold">{props.title}</h1><p className="break-all text-xs text-slate-400">{props.subtitle ?? t("chatSubtitle")}</p>
          {props.status && <span className={`text-xs ${props.status.kind === "ok" ? "text-emerald-300" : "text-amber-300"}`}>● {props.status.text}</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <LanguagePicker compact />
        {props.shareUrl && <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(props.shareUrl!); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setFailure("Clipboard unavailable. Copy the complete URL from the address bar."); } }} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">{t(copied ? "copiedLink" : "copyLink")}</button>}
        {props.onNext && <button type="button" onClick={() => setConfirm("next")} className="rounded-lg bg-indigo-500 px-3 py-2">{t("nextBtn")}</button>}
        {props.onCloseRoom && <button type="button" onClick={() => setConfirm("close")} className="rounded-lg border border-rose-700 bg-rose-500/10 px-3 py-2 text-rose-200">{t("closeRoom")}</button>}
        {props.onLeave && <button type="button" onClick={() => setConfirm("leave")} className="rounded-lg border border-slate-700 px-3 py-2">{props.customLeaveLabel ?? t("leaveBtn")}</button>}
        {props.headerRight}
      </div>
    </header>
    <div ref={scroll} role="log" aria-live="polite" aria-relevant="additions" aria-label={t("chatTitleDefault")} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {!messages.length && <p className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">{t(props.disabled ? "emptyWaiting" : "emptyIce")}</p>}
        {messages.map(m => m.systemFlag ? <p key={m.id} className="self-center text-xs text-slate-400">{m.body}</p> : <div key={m.id} className={`flex ${m.senderUserId === props.selfUserId ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.senderUserId === props.selfUserId ? "rounded-br-md bg-indigo-600" : "rounded-bl-md bg-slate-800"}`}>
            {m.senderUserId !== props.selfUserId && <p className="mb-1 text-[11px] text-slate-400"><bdi>{m.senderName}</bdi></p>}
            <div data-testid="message-body" dir="auto" className="whitespace-pre-wrap break-words">{m.body}</div>
            <time className="mt-1 block text-[10px] opacity-60" dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time>
          </div>
        </div>)}
      </div>
    </div>
    <footer className="border-t border-slate-800 bg-slate-900/60 p-4">
      {failure && <p role="alert" className="mx-auto mb-2 max-w-2xl text-sm text-rose-300">{failure}</p>}
      <form className="mx-auto flex max-w-2xl gap-2" onSubmit={e => { e.preventDefault(); void send(); }}>
        <label className="sr-only" htmlFor={id}>{t("inputPlaceholder")}</label>
        <input id={id} ref={input} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault(); }} placeholder={props.placeholder ?? t("inputPlaceholder")} maxLength={2000} disabled={props.disabled} autoComplete="off" className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm focus:border-indigo-400 focus:outline-none disabled:opacity-50" />
        <button aria-label={t("sendBtn")} disabled={props.disabled || sending || !draft.trim()} className="rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold disabled:opacity-50">{t(sending ? "sendingBtn" : "sendBtn")}</button>
      </form>
      <p className="mt-2 text-center text-[10px] text-slate-500">{t("beRespectful", { name: props.selfName })}</p>
    </footer>
    <ConfirmDialog open={!!confirm} {...confirmKeys} destructive={confirm !== "next"} onCancel={() => setConfirm(null)} onConfirm={() => { const action = confirm === "next" ? props.onNext : confirm === "close" ? props.onCloseRoom : props.onLeave; setConfirm(null); void action?.(); }} />
  </div>;
}
