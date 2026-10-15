"use client";

import type { RoomSnapshot } from "@/lib/chat";
import type { EncryptedMessageEnvelope } from "@/lib/chat-events";
import {
  createEcdhCredentials,
  createPrivateSecret,
  decryptMessage,
  encryptMessage,
  ensureSigningCredentials,
  getRoomCryptoKey,
  getRoomSafetyCode,
  isValidPrivateSecret,
  privateSecretCommitment,
  serializePublicKey,
  serializeSigningKey,
  signEnvelope,
  verifyEnvelopeSignature,
} from "@/lib/e2ee";
import {
  getLanguageDirection,
  isLanguageCode,
  languages,
  translate,
  type LanguageCode,
  type TranslationKey,
} from "@/lib/i18n";
import {
  createParticipantId,
  loadLocalConversations,
  LOCAL_CHATS_KEY,
  saveLocalEncryption,
  saveLocalMessage,
  saveLocalRoom,
  setLocalRoomStatus,
  type ConversationEncryption,
  type LocalChatMessage,
  type LocalConversation,
} from "@/lib/local-chats";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Globe2,
  HardDrive,
  Heart,
  Home,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Send,
  ShieldCheck,
  Shuffle,
  Sparkles,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type ChatMessage = LocalChatMessage;

type Screen = "home" | "matching" | "chat" | "loading" | "error";
type ServiceStatus = "checking" | "active" | "unavailable";
type Translator = (key: TranslationKey) => string;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5" aria-label="Luma home">
      <span className="relative grid h-9 w-9 place-items-center rounded-full bg-[#ff6747] text-white shadow-[0_6px_16px_rgba(255,103,71,0.25)]">
        <MessageCircle size={18} strokeWidth={2.5} />
        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[#f8f6f0] bg-[#a7ca98]" />
      </span>
      <span className="text-[19px] font-extrabold tracking-[-0.04em] text-[#1e2927]">luma</span>
    </div>
  );
}

function LanguageSelector({
  language,
  onLanguage,
  t,
}: {
  language: LanguageCode;
  onLanguage: (language: LanguageCode) => void;
  t: Translator;
}) {
  return (
    <label className="language-select relative inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dfe2db] bg-white/80 px-2.5 text-[#65706c] transition hover:bg-white">
      <Globe2 size={14} className="shrink-0" aria-hidden="true" />
      <span className="sr-only">{t("selectLanguage")}</span>
      <select
        value={language}
        onChange={(event) => onLanguage(event.target.value as LanguageCode)}
        aria-label={t("selectLanguage")}
        className="max-w-[105px] cursor-pointer appearance-none bg-transparent pe-3 text-[11px] font-bold outline-none sm:max-w-[135px]"
      >
        {languages.map((item) => (
          <option key={item.code} value={item.code}>{item.name}</option>
        ))}
      </select>
    </label>
  );
}

function Header({
  t,
  language,
  onLanguage,
  inRoom = false,
}: {
  t: Translator;
  language: LanguageCode;
  onLanguage: (language: LanguageCode) => void;
  inRoom?: boolean;
}) {
  return (
    <header className="relative z-30 mx-auto flex h-[76px] w-full max-w-[1500px] items-center justify-between gap-3 px-5 sm:px-8">
      {inRoom ? (
        <div className="shrink-0" aria-label="Luma"><Brand /></div>
      ) : (
        <a href="/" className="shrink-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6747]/40">
          <Brand />
        </a>
      )}
      <div className="flex min-w-0 items-center gap-2.5 sm:gap-5">
        {!inRoom && (
          <nav className="hidden items-center gap-7 text-[12px] font-semibold text-[#66706d] lg:flex">
            <a className="transition hover:text-[#1e2927]" href="#how-it-works">{t("howItWorks")}</a>
            <a className="transition hover:text-[#1e2927]" href="#safety">{t("safety")}</a>
            <span className="flex items-center gap-2 rounded-full border border-[#dfe2db] bg-white/70 px-3.5 py-2 text-[11px] text-[#3f4946]">
              <MessageCircle size={13} className="text-[#6c9161]" />
              {t("textOnly")}
            </span>
          </nav>
        )}
        {inRoom && (
          <span className="hidden items-center gap-2 text-[11px] font-semibold text-[#5f7f56] md:flex">
            <ShieldCheck size={14} /> {t("e2ee")}
          </span>
        )}
        <LanguageSelector language={language} onLanguage={onLanguage} t={t} />
      </div>
    </header>
  );
}

function DemoConversation({ t }: { t: Translator }) {
  return (
    <div className="hero-visual relative mx-auto w-full max-w-[500px] lg:ml-auto">
      <div className="absolute -left-8 top-16 h-24 w-24 rounded-full bg-[#dbe9d5] blur-[1px]" />
      <div className="absolute -right-5 bottom-16 h-32 w-32 rounded-full bg-[#ffdfd4]" />
      <div className="chat-demo relative overflow-hidden rounded-[30px] border border-white/80 bg-white p-3 shadow-[0_30px_80px_rgba(45,55,51,0.13)]">
        <div className="flex items-center justify-between rounded-[22px] bg-[#f4f3ee] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="relative grid h-10 w-10 place-items-center rounded-full bg-[#dcead7] text-[#52744a]">
              <UserRound size={19} />
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#f4f3ee] bg-[#72b25f]" />
            </div>
            <div>
              <p className="text-[13px] font-bold text-[#27312f]">{t("friendlyStranger")}</p>
              <p className="mt-0.5 text-[11px] text-[#7b8581]">{t("connectedNow")}</p>
            </div>
          </div>
          <div className="flex gap-1.5"><span className="h-2 w-2 rounded-full bg-[#c8ccc6]" /><span className="h-2 w-2 rounded-full bg-[#c8ccc6]" /><span className="h-2 w-2 rounded-full bg-[#c8ccc6]" /></div>
        </div>
        <div className="min-h-[342px] px-4 pb-4 pt-7">
          <div className="mb-5 text-center text-[10px] font-semibold uppercase tracking-[0.13em] text-[#a0a7a3]">{t("nowChatting")}</div>
          <div className="flex items-end gap-2.5">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#dcead7] text-[#5e7d56]"><UserRound size={13} /></div>
            <div className="max-w-[72%] rounded-[18px] rounded-bl-[5px] bg-[#f0f1ec] px-4 py-3 text-[13px] leading-relaxed text-[#394340]">{t("demoQuestion")}</div>
          </div>
          <div className="mt-4 flex justify-end"><div className="max-w-[72%] rounded-[18px] rounded-br-[5px] bg-[#ff6747] px-4 py-3 text-[13px] leading-relaxed text-white shadow-[0_8px_18px_rgba(255,103,71,0.18)]">{t("demoAnswer")}</div></div>
          <div className="mt-4 flex items-end gap-2.5">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#dcead7] text-[#5e7d56]"><UserRound size={13} /></div>
            <div className="rounded-[16px] rounded-bl-[5px] bg-[#f0f1ec] px-4 py-3"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-[18px] border border-[#e8e8e2] px-4 py-3 text-[12px] text-[#a0a6a2]">
          {t("typeMessage")}<span className="ms-auto grid h-8 w-8 place-items-center rounded-full bg-[#ff6747] text-white"><Send size={14} /></span>
        </div>
      </div>
      <div className="absolute -right-3 top-[90px] flex items-center gap-2 rounded-full border border-white bg-white px-3.5 py-2 text-[11px] font-bold text-[#4d5854] shadow-[0_12px_30px_rgba(40,48,45,0.13)] sm:-right-8">
        <ShieldCheck size={15} className="text-[#72a961]" /> {t("noProfile")}
      </div>
    </div>
  );
}

function ConversationSidebar({
  conversations,
  currentRoomId,
  language,
  t,
  onOpenChat,
  contained = false,
}: {
  conversations: LocalConversation[];
  currentRoomId?: string;
  language: LanguageCode;
  t: Translator;
  onOpenChat: (conversation: LocalConversation) => void;
  contained?: boolean;
}) {
  return (
    <aside className={`${contained ? "history-sidebar-contained" : "history-sidebar-page"} flex min-w-0 flex-col border-[#e3e4dd] bg-[#f4f3ee]`} aria-label={t("yourChats")}>
      <div className="flex items-start justify-between gap-3 border-b border-[#e1e2dc] p-4 lg:p-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[13px] font-extrabold text-[#303b37]"><MessageCircle size={15} className="text-[#ff6747]" /> {t("yourChats")}</h2>
          <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-[#8a928f]">{t("yourChatsCopy")}</p>
        </div>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white text-[#75906d]" title={t("storedLocally")}><HardDrive size={14} /></span>
      </div>

      <div className="history-list flex min-h-0 gap-2 overflow-x-auto p-3 lg:flex-1 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex min-w-[220px] items-center gap-3 rounded-2xl border border-dashed border-[#d8dbd4] bg-white/55 p-4 lg:min-w-0 lg:flex-col lg:py-8 lg:text-center">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#edf3e9] text-[#78956f]"><MessageCircle size={16} /></span>
            <p className="text-[10px] leading-5 text-[#8b9390]">{t("yourChatsCopy")}</p>
          </div>
        ) : conversations.map((conversation) => {
          const active = conversation.status !== "ended";
          const selected = conversation.roomId === currentRoomId;
          const lastMessage = conversation.messages.at(-1);
          const statusLabel = conversation.status === "active"
            ? t("connected")
            : conversation.status === "waiting"
              ? t("waitingSomeone")
              : t("conversationEnded");
          return (
            <button
              key={conversation.roomId}
              onClick={() => onOpenChat(conversation)}
              aria-current={selected ? "page" : undefined}
              className={`group min-w-[235px] rounded-2xl border p-3.5 text-start transition lg:min-w-0 ${selected ? "border-[#f2a08e] bg-white shadow-[0_8px_20px_rgba(60,67,63,0.08)]" : "border-transparent bg-white/55 hover:border-[#dfe1da] hover:bg-white"}`}
            >
              <div className="flex items-start gap-3">
                <span className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-xl ${selected ? "bg-[#fff0ea] text-[#ef6547]" : "bg-[#e9efe5] text-[#708b68]"}`}>
                  {conversation.kind === "private" ? <LockKeyhole size={15} /> : <UserRound size={15} />}
                  <span className={`absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${active ? conversation.status === "waiting" ? "bg-[#dfa34d]" : "bg-[#72b05f]" : "bg-[#aeb4b0]"}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <strong className="truncate text-[11px] font-extrabold text-[#37423e]">{conversation.kind === "private" ? t("privateConversation") : t("stranger")}</strong>
                    <time className="shrink-0 text-[8px] font-semibold text-[#a0a6a3]">{new Date(conversation.updatedAt).toLocaleDateString(language, { month: "short", day: "numeric" })}</time>
                  </span>
                  <span className="mt-1 block truncate text-[9px] font-semibold text-[#82907f]">{statusLabel}</span>
                  <span className="mt-1.5 block truncate text-[10px] text-[#8a928f]">{lastMessage?.body ?? t("noLocalMessages")}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="hidden border-t border-[#e1e2dc] px-5 py-4 text-[9px] font-semibold leading-4 text-[#667c61] lg:block">
        <span className="flex items-center gap-2"><ShieldCheck size={13} className="shrink-0" /> {t("e2ee")}</span>
        <span className="mt-1.5 block text-[#8a928f]">{t("serverBlind")} · {t("storedLocally")}</span>
      </div>
    </aside>
  );
}

function HomeScreen({
  onRandom,
  onPrivate,
  busy,
  serviceStatus,
  conversations,
  t,
  language,
  onLanguage,
  onOpenChat,
}: {
  onRandom: () => void;
  onPrivate: () => void;
  busy: boolean;
  serviceStatus: ServiceStatus;
  conversations: LocalConversation[];
  t: Translator;
  language: LanguageCode;
  onLanguage: (language: LanguageCode) => void;
  onOpenChat: (conversation: LocalConversation) => void;
}) {
  const features = [
    [Zap, t("instantTitle"), t("instantCopy")],
    [LockKeyhole, t("privateTitle"), t("privateCopy")],
    [Link2, t("linkTitle"), t("linkCopy")],
  ] as const;

  return (
    <div className="min-h-screen overflow-hidden bg-[#f8f6f0]">
      <Header t={t} language={language} onLanguage={onLanguage} />
      <main className="home-with-sidebar mx-auto grid w-full max-w-[1500px] lg:grid-cols-[280px_minmax(0,1fr)]">
        <ConversationSidebar conversations={conversations} language={language} t={t} onOpenChat={onOpenChat} />
        <div className="min-w-0">
        <section className="relative mx-auto grid w-full max-w-[1180px] items-center gap-14 px-5 pb-20 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[1.04fr_0.96fr] lg:pb-28 lg:pt-20">
          <div className="relative z-10 max-w-[625px]">
            <div className="mb-6 flex flex-wrap items-center gap-2.5">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#e7ddd5] bg-white/75 px-3.5 py-2 text-[11px] font-extrabold uppercase tracking-[0.13em] text-[#7b6960]">
                <Sparkles size={13} className="text-[#ff6747]" /> {t("eyebrow")}
              </div>
              <span className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[11px] font-extrabold ${serviceStatus === "active" ? "border-[#d6e5d0] bg-[#edf5e9] text-[#52774a]" : serviceStatus === "unavailable" ? "border-[#f1d5cd] bg-[#fff0ec] text-[#b9553f]" : "border-[#e6dfcf] bg-[#f7f2e7] text-[#88734c]"}`} role="status" aria-live="polite">
                <span className={`h-2 w-2 rounded-full ${serviceStatus === "active" ? "bg-[#72b05f] shadow-[0_0_0_4px_rgba(114,176,95,0.12)]" : serviceStatus === "unavailable" ? "bg-[#e36447]" : "animate-pulse bg-[#d3a14e]"}`} />
                {serviceStatus === "active" ? t("serviceActive") : serviceStatus === "unavailable" ? t("serviceUnavailable") : t("serviceChecking")}
              </span>
            </div>
            <h1 className="text-balance text-[clamp(3.15rem,6.5vw,5.45rem)] font-extrabold leading-[0.98] tracking-[-0.065em] text-[#1e2927]">
              {t("heroLead")} <span className="relative text-[#ff6747]">{t("heroAccent")}<svg className="absolute -bottom-2 start-1 w-[96%]" viewBox="0 0 240 12" fill="none" aria-hidden="true"><path d="M3 8C62 2 158 2 237 6" stroke="#ffb39f" strokeWidth="5" strokeLinecap="round" /></svg></span>
            </h1>
            <p className="mt-7 max-w-[530px] text-[17px] leading-[1.75] text-[#68716e] sm:text-[18px]">{t("heroCopy")}</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <button onClick={onRandom} disabled={busy} className="group inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-[#ff6747] px-7 text-[14px] font-extrabold text-white shadow-[0_12px_28px_rgba(255,103,71,0.24)] transition hover:-translate-y-0.5 hover:bg-[#f65c3d] disabled:opacity-60">
                {busy ? <LoaderCircle size={18} className="animate-spin" /> : <Shuffle size={18} />}{t("chatStranger")}<ArrowRight size={17} className="transition-transform group-hover:translate-x-1 rtl:rotate-180" />
              </button>
              <button onClick={onPrivate} disabled={busy} className="inline-flex min-h-14 items-center justify-center gap-2.5 rounded-2xl border border-[#d9ddd5] bg-white/75 px-6 text-[14px] font-extrabold text-[#394340] transition hover:-translate-y-0.5 hover:border-[#c9cec5] hover:bg-white disabled:opacity-60"><Link2 size={17} /> {t("createPrivate")}</button>
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-semibold text-[#8a918e]">
              <span className="flex items-center gap-1.5"><Check size={13} className="text-[#72a961]" /> {t("anonymousDesign")}</span>
              <span className="flex items-center gap-1.5"><Check size={13} className="text-[#72a961]" /> {t("leaveAnytime")}</span>
              <span className="flex items-center gap-1.5"><Check size={13} className="text-[#72a961]" /> {t("noAccount")}</span>
            </div>
          </div>
          <DemoConversation t={t} />
          <div className="hero-orb pointer-events-none absolute -left-[180px] top-5 h-[380px] w-[380px] rounded-full bg-[#fff0e8] blur-3xl" />
        </section>

        <section id="how-it-works" className="border-y border-[#e7e6df] bg-white/55">
          <div className="mx-auto grid max-w-[1180px] divide-y divide-[#e5e6df] px-5 py-5 sm:px-8 md:grid-cols-3 md:divide-x md:divide-y-0 md:py-7">
            {features.map(([ItemIcon, title, copy], index) => (
              <div key={title} className={`flex items-center gap-4 py-5 md:px-8 ${index === 0 ? "md:ps-0" : ""}`}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#edf2e9] text-[#6c9161]"><ItemIcon size={19} /></span>
                <div><h2 className="text-[13px] font-extrabold text-[#303a37]">{title}</h2><p className="mt-1 text-[11px] leading-relaxed text-[#8a918e]">{copy}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section id="safety" className="mx-auto max-w-[1180px] px-5 py-20 sm:px-8 lg:py-24">
          <div className="grid gap-8 rounded-[32px] bg-[#202c29] p-8 text-white sm:p-12 lg:grid-cols-[1fr_auto] lg:items-center lg:px-14">
            <div className="max-w-2xl">
              <div className="mb-4 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#a9caa0]"><ShieldCheck size={16} /> {t("safetyEyebrow")}</div>
              <h2 className="text-[clamp(1.8rem,4vw,3rem)] font-extrabold tracking-[-0.045em]">{t("safetyTitle")}</h2>
              <p className="mt-4 max-w-xl text-[14px] leading-7 text-[#b8c1be]">{t("safetyCopy")}</p>
            </div>
            <button onClick={onRandom} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-[13px] font-extrabold text-[#25312e] transition hover:bg-[#f0f3ed]">{t("startTalking")} <ChevronRight size={16} className="rtl:rotate-180" /></button>
          </div>
        </section>
        </div>
      </main>
      <footer className="mx-auto flex max-w-[1180px] flex-col gap-4 border-t border-[#e4e3dc] px-5 py-8 text-[11px] text-[#929996] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Brand /><p>{t("footer")}</p><p>© {new Date().getFullYear()} Luma</p>
      </footer>
    </div>
  );
}

function MatchingScreen({
  onCancel,
  conversations,
  currentRoomId,
  t,
  language,
  onLanguage,
  onOpenChat,
}: {
  onCancel: () => void;
  conversations: LocalConversation[];
  currentRoomId?: string;
  t: Translator;
  language: LanguageCode;
  onLanguage: (language: LanguageCode) => void;
  onOpenChat: (conversation: LocalConversation) => void;
}) {
  return (
    <div className="min-h-screen bg-[#f8f6f0]">
      <Header t={t} language={language} onLanguage={onLanguage} inRoom />
      <main className="mx-auto grid min-h-[calc(100vh-76px)] w-full max-w-[1400px] lg:grid-cols-[280px_minmax(0,1fr)]">
        <ConversationSidebar conversations={conversations} currentRoomId={currentRoomId} language={language} t={t} onOpenChat={onOpenChat} />
        <div className="grid min-h-[calc(100vh-76px)] place-items-center px-5 pb-20 pt-10 lg:pt-0">
          <div className="w-full max-w-[580px] text-center">
            <div className="search-radar mx-auto mb-9 grid h-40 w-40 place-items-center rounded-full">
              <div className="search-radar-inner grid h-20 w-20 place-items-center rounded-full bg-[#ff6747] text-white shadow-[0_14px_35px_rgba(255,103,71,0.28)]"><Users size={31} /></div>
            </div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#edf3e9] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#68815f]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#79ad69]" /> {t("matchingLive")}</div>
            <h1 className="text-[clamp(2.2rem,6vw,4rem)] font-extrabold tracking-[-0.055em] text-[#202b28]">{t("matchingTitle")}</h1>
            <p className="mx-auto mt-4 max-w-md text-[15px] leading-7 text-[#79817e]">{t("matchingCopy")}</p>
            <div className="mx-auto mt-9 flex max-w-sm items-center gap-3 rounded-2xl border border-[#e1e2dc] bg-white p-4 text-start shadow-[0_12px_34px_rgba(50,58,55,0.06)]">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#fff0ea] text-[#ef694a]"><Heart size={18} /></span>
              <p className="text-[11px] leading-5 text-[#7c8481]"><strong className="block text-[12px] text-[#3a4541]">{t("reminder")}</strong>{t("reminderCopy")}</p>
            </div>
            <button onClick={onCancel} className="mt-8 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-bold text-[#8a918e] transition hover:bg-white hover:text-[#3d4744]"><X size={15} /> {t("cancelSearch")}</button>
          </div>
        </div>
      </main>
    </div>
  );
}

function ChatScreen({
  room,
  clientId,
  messages,
  draft,
  sending,
  copied,
  relayReady,
  partnerTyping,
  safetyCode,
  conversations,
  t,
  language,
  onLanguage,
  onOpenChat,
  onDraft,
  onSend,
  onKeyDown,
  onCopy,
  onPause,
  onLeave,
  onNext,
}: {
  room: RoomSnapshot;
  clientId: string;
  messages: ChatMessage[];
  draft: string;
  sending: boolean;
  copied: boolean;
  relayReady: boolean;
  partnerTyping: boolean;
  safetyCode: string;
  conversations: LocalConversation[];
  t: Translator;
  language: LanguageCode;
  onLanguage: (language: LanguageCode) => void;
  onOpenChat: (conversation: LocalConversation) => void;
  onDraft: (value: string) => void;
  onSend: (event?: FormEvent) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCopy: () => void;
  onPause: () => void;
  onLeave: () => void;
  onNext: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const localConversation = conversations.find((item) => item.roomId === room.id);
  const [confirmAction, setConfirmAction] = useState<"leave" | "next" | null>(null);
  const waiting = room.status === "waiting";
  const ended = room.status === "ended" || !room.participantActive;
  const secureReady = relayReady && Boolean(safetyCode);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, waiting, ended]);

  useEffect(() => {
    if (ended) setConfirmAction(null);
  }, [ended]);

  useEffect(() => {
    if (!confirmAction) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setConfirmAction(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmAction]);

  useEffect(() => {
    if (waiting || ended || !secureReady || confirmAction || sending) return;
    const frame = window.requestAnimationFrame(() => composerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [confirmAction, ended, secureReady, sending, waiting]);

  useEffect(() => {
    if (waiting || ended || !secureReady || confirmAction) return;
    const focusOnTyping = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.key.length !== 1 ||
        draft.length >= 1200
      ) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) return;

      event.preventDefault();
      composerRef.current?.focus();
      onDraft(`${draft}${event.key}`);
    };

    window.addEventListener("keydown", focusOnTyping);
    return () => window.removeEventListener("keydown", focusOnTyping);
  }, [confirmAction, draft, ended, onDraft, secureReady, waiting]);

  const confirmEnd = () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === "next") onNext();
    if (action === "leave") onLeave();
  };

  return (
    <div className="min-h-screen bg-[#f5f3ed]">
      <Header t={t} language={language} onLanguage={onLanguage} inRoom />
      <main className="mx-auto max-w-[1400px] px-3 pb-5 sm:px-6 sm:pb-8">
        <div className="chat-shell grid h-[calc(100vh-102px)] min-h-[610px] overflow-hidden rounded-[26px] border border-[#dedfd8] bg-white shadow-[0_24px_70px_rgba(42,50,47,0.10)] lg:grid-cols-[280px_1fr]">
          <ConversationSidebar conversations={conversations} currentRoomId={room.id} language={language} t={t} onOpenChat={onOpenChat} contained />

          <section className="flex min-w-0 flex-col">
            <div className="flex h-[74px] shrink-0 items-center justify-between border-b border-[#ecece7] px-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#dcebd7] text-[#5d7d54] lg:hidden"><UserRound size={18} /></div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><h1 className="truncate text-[14px] font-extrabold text-[#293430]">{room.kind === "private" ? t("privateConversation") : t("yourConversation")}</h1>{room.kind === "private" && <LockKeyhole size={12} className="text-[#84918c]" />}</div>
                  <p className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-[#8b9390]"><span className={`h-1.5 w-1.5 rounded-full ${ended ? "bg-[#b7bcb8]" : waiting || !secureReady ? "animate-pulse bg-[#e5a64f]" : "bg-[#72b05f]"}`} />{ended ? t("conversationEnded") : waiting ? t("waitingSomeone") : !secureReady ? t("connecting") : t("connected")}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {safetyCode && <span className="hidden h-9 items-center gap-2 rounded-xl bg-[#edf3e9] px-3 font-mono text-[9px] font-bold text-[#587052] md:inline-flex" title={t("compareCode")}><ShieldCheck size={13} /> {t("safetyCode")}: {safetyCode}</span>}
                <button onClick={onPause} className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#e1e3dd] px-3 text-[10px] font-extrabold text-[#59635f] transition hover:bg-[#f7f7f3]" aria-label={t("backToChats")}><Home size={14} /><span className="hidden xl:inline">{t("backToChats")}</span></button>
                {room.kind === "private" && !ended && <button onClick={onCopy} className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#e1e3dd] px-3 text-[10px] font-extrabold text-[#59635f] transition hover:bg-[#f7f7f3] sm:px-4">{copied ? <Check size={14} className="text-[#6ca45e]" /> : <Copy size={14} />}<span className="hidden sm:inline">{copied ? t("copied") : t("inviteLink")}</span></button>}
                {room.kind === "random" && !waiting && !ended && <button onClick={() => setConfirmAction("next")} className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#e1e3dd] px-3 text-[10px] font-extrabold text-[#59635f] transition hover:bg-[#f7f7f3]"><Shuffle size={14} /><span className="hidden sm:inline">{t("next")}</span></button>}
                <button onClick={() => ended ? onLeave() : setConfirmAction("leave")} className="grid h-9 w-9 place-items-center rounded-xl text-[#929995] transition hover:bg-[#fff0ec] hover:text-[#e76145]" aria-label={t("leaveChat")}><LogOut size={16} /></button>
              </div>
            </div>

            <div ref={scrollRef} className="chat-scroll flex-1 overflow-y-auto px-4 py-6 sm:px-8">
              {waiting && room.kind === "private" ? (
                <div className="grid h-full min-h-[360px] place-items-center">
                  <div className="max-w-md text-center">
                    <div className="invite-pulse mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#fff0ea] text-[#f26749]"><Link2 size={28} /></div>
                    <h2 className="mt-6 text-[25px] font-extrabold tracking-[-0.04em] text-[#27322f]">{t("roomReady")}</h2>
                    <p className="mx-auto mt-3 max-w-sm text-[13px] leading-6 text-[#7d8582]">{t("roomReadyCopy")}</p>
                    <button onClick={onCopy} className="mx-auto mt-6 inline-flex min-h-12 items-center gap-2.5 rounded-xl bg-[#ff6747] px-6 py-3 text-[12px] font-extrabold text-white shadow-[0_10px_24px_rgba(255,103,71,0.22)] transition hover:-translate-y-0.5">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? t("linkCopied") : t("copyInvite")}</button>
                    <p className="mt-4 flex items-center justify-center gap-1.5 text-[10px] font-semibold text-[#a0a6a3]"><LockKeyhole size={11} /> {t("oneGuest")}</p>
                  </div>
                </div>
              ) : ended ? (
                <>
                  <div className="mb-7 rounded-2xl border border-[#e4e5df] bg-[#f5f5f1] p-5 text-center">
                    <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-white text-[#7c8581]"><MessageCircle size={18} /></div>
                    <h2 className="mt-3 text-[17px] font-extrabold tracking-[-0.03em] text-[#27322f]">{t("endedTitle")}</h2>
                    <p className="mx-auto mt-1.5 max-w-md text-[11px] leading-5 text-[#7d8582]">{t("endedCopy")}</p>
                  </div>
                  {messages.length === 0 ? (
                    <p className="py-10 text-center text-[11px] font-semibold text-[#9ba29f]">{t("noLocalMessages")}</p>
                  ) : (
                    <div className="space-y-4">
                      {messages.map((message) => {
                        const mine = message.senderPublicId === room.participantPublicId ||
                          (!message.senderPublicId && message.senderClientId === localConversation?.clientId);
                        return (
                          <div key={message.id} className={`flex items-end gap-2.5 ${mine ? "justify-end" : "justify-start"}`}>
                            {!mine && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#dcebd7] text-[#5d7d54]"><UserRound size={13} /></span>}
                            <div className={`max-w-[78%] sm:max-w-[68%] ${mine ? "text-end" : ""}`}>
                              <div className={`whitespace-pre-wrap break-words px-4 py-3 text-start text-[13px] leading-6 ${mine ? "rounded-[18px] rounded-br-[5px] bg-[#ff6747] text-white" : "rounded-[18px] rounded-bl-[5px] bg-[#f0f1ec] text-[#39433f]"}`}>{message.body}</div>
                              <p className="mt-1.5 px-1 text-[9px] font-semibold text-[#a4aaa7]">{new Date(message.createdAt).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="mb-7 flex items-center gap-3 text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#b0b5b2]"><span className="h-px flex-1 bg-[#eeeeea]" />{t("conversationStarted")}<span className="h-px flex-1 bg-[#eeeeea]" /></div>
                  {messages.length === 0 && (
                    <div className="mx-auto mt-8 max-w-sm text-center">
                      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#edf3e9] text-[#729567]"><Sparkles size={21} /></div>
                      <p className="mt-4 text-[13px] font-extrabold text-[#46514d]">{t("helloTitle")}</p>
                      <p className="mt-1.5 text-[11px] text-[#969c99]">{t("helloCopy")}</p>
                    </div>
                  )}
                  <div className="space-y-4 pt-4">
                    {messages.map((message) => {
                      const mine = message.senderPublicId === room.participantPublicId ||
                          (!message.senderPublicId && message.senderClientId === localConversation?.clientId);
                      return (
                        <div key={message.id} className={`flex items-end gap-2.5 ${mine ? "justify-end" : "justify-start"}`}>
                          {!mine && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#dcebd7] text-[#5d7d54]"><UserRound size={13} /></span>}
                          <div className={`max-w-[78%] sm:max-w-[68%] ${mine ? "text-end" : ""}`}>
                            <div className={`whitespace-pre-wrap break-words px-4 py-3 text-start text-[13px] leading-6 ${mine ? "rounded-[18px] rounded-br-[5px] bg-[#ff6747] text-white shadow-[0_7px_18px_rgba(255,103,71,0.13)]" : "rounded-[18px] rounded-bl-[5px] bg-[#f0f1ec] text-[#39433f]"}`}>{message.body}</div>
                            <p className="mt-1.5 px-1 text-[9px] font-semibold text-[#a4aaa7]">{new Date(message.createdAt).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {partnerTyping && !waiting && !ended && (
                <div className="mt-5 flex items-center gap-2.5 text-[10px] font-semibold text-[#78847b]" role="status" aria-live="polite">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[#edf3e9] text-[#63805a]"><UserRound size={13} /></span>
                  <span>{t("partnerTyping")}</span>
                  <span className="typing-indicator" aria-hidden="true"><i /><i /><i /></span>
                </div>
              )}
            </div>

            <form onSubmit={onSend} className="shrink-0 border-t border-[#ecece7] bg-white p-3 sm:p-4">
              <div className={`flex items-end gap-2 rounded-2xl border bg-[#fafaf7] p-2 ps-4 transition focus-within:border-[#f5a18e] focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(255,103,71,0.08)] ${waiting || ended || !secureReady ? "border-[#e8e9e4] opacity-60" : "border-[#e2e3dd]"}`}>
                <textarea ref={composerRef} value={draft} onChange={(event) => onDraft(event.target.value)} onKeyDown={onKeyDown} disabled={waiting || ended || !secureReady} maxLength={1200} rows={1} placeholder={waiting ? t("waitingPlaceholder") : ended ? t("endedPlaceholder") : !secureReady ? t("connecting") : t("writeMessage")} className="max-h-28 min-h-10 flex-1 resize-none bg-transparent py-2 text-[13px] leading-6 text-[#313b38] outline-none placeholder:text-[#aab0ad]" />
                <button type="submit" disabled={!draft.trim() || waiting || ended || !secureReady || sending} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#ff6747] text-white transition hover:bg-[#f45d3e] disabled:bg-[#d9dcd6]" aria-label={t("sendMessage")}>{sending ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}</button>
              </div>
              <div className="mt-2 hidden items-center justify-between px-1 text-[9px] font-semibold text-[#abb0ad] sm:flex"><span>{t("keyboardHint")}</span><span>{draft.length}/1200</span></div>
            </form>
          </section>
        </div>
      </main>

      {confirmAction && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#17211f]/45 px-5 backdrop-blur-[3px]" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setConfirmAction(null); }}>
          <section role="alertdialog" aria-modal="true" aria-labelledby="end-chat-title" aria-describedby="end-chat-description" className="w-full max-w-[430px] rounded-[26px] border border-white/70 bg-white p-6 shadow-[0_28px_90px_rgba(25,34,31,0.28)] sm:p-8">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff0eb] text-[#ef6445]"><AlertTriangle size={22} /></div>
            <h2 id="end-chat-title" className="mt-5 text-[24px] font-extrabold tracking-[-0.04em] text-[#26312e]">{t("confirmTitle")}</h2>
            <p id="end-chat-description" className="mt-3 text-[13px] leading-6 text-[#737c78]">{confirmAction === "next" ? t("confirmNext") : t("confirmLeave")}</p>
            <div className="mt-7 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
              <button onClick={() => setConfirmAction(null)} autoFocus className="min-h-11 rounded-xl border border-[#dfe2dc] px-5 text-[12px] font-extrabold text-[#59635f] transition hover:bg-[#f7f7f3]">{t("keepChatting")}</button>
              <button onClick={confirmEnd} className="min-h-11 rounded-xl bg-[#e95f43] px-5 text-[12px] font-extrabold text-white shadow-[0_8px_20px_rgba(233,95,67,0.2)] transition hover:bg-[#d9543a]">{confirmAction === "next" ? t("endAndNext") : t("endChat")}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default function ChatApp({ initialRoomId }: { initialRoomId?: string }) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [language, setLanguage] = useState<LanguageCode>("en");
  const [screen, setScreen] = useState<Screen>(initialRoomId ? "loading" : "home");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [conversations, setConversations] = useState<LocalConversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>("checking");
  const [relayReady, setRelayReady] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [safetyCode, setSafetyCode] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const openedRoomId = useRef<string | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSignal = useRef(0);
  const t = useCallback((key: TranslationKey) => translate(language, key), [language]);

  useEffect(() => {
    setConversations(loadLocalConversations());
    setStorageReady(true);

    const savedLanguage = window.localStorage.getItem("luma-language");
    if (isLanguageCode(savedLanguage)) {
      setLanguage(savedLanguage);
      return;
    }
    for (const browserLocale of navigator.languages) {
      const candidate = browserLocale.toLowerCase().split("-")[0];
      if (isLanguageCode(candidate)) {
        setLanguage(candidate);
        break;
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = getLanguageDirection(language);
    window.localStorage.setItem("luma-language", language);
  }, [language]);

  const changeLanguage = useCallback((nextLanguage: LanguageCode) => {
    setLanguage(nextLanguage);
  }, []);

  useEffect(() => {
    const activeRoomId = room?.id;
    const syncLocalChats = (event: StorageEvent) => {
      if (event.key !== LOCAL_CHATS_KEY) return;
      const next = loadLocalConversations();
      setConversations(next);
      if (activeRoomId) {
        const active = next.find((conversation) => conversation.roomId === activeRoomId);
        if (active) setMessages(active.messages);
      }
    };
    window.addEventListener("storage", syncLocalChats);
    return () => window.removeEventListener("storage", syncLocalChats);
  }, [room?.id]);

  useEffect(() => {
    let cancelled = false;
    const calculateSafetyCode = async () => {
      if (!room) {
        setSafetyCode("");
        return;
      }
      const conversation = loadLocalConversations().find(
        (item) => item.roomId === room.id,
      );
      try {
        const code = await getRoomSafetyCode(conversation?.encryption, room);
        if (!cancelled) setSafetyCode(code);
      } catch {
        if (!cancelled) setSafetyCode("");
      }
    };
    void calculateSafetyCode();
    return () => { cancelled = true; };
  }, [room?.id, room?.partnerPublicKey, room?.partnerSigningKey]);

  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const payload = (await response.json()) as { ok?: boolean };
        if (!cancelled) {
          setServiceStatus(response.ok && payload.ok ? "active" : "unavailable");
        }
      } catch {
        if (!cancelled) setServiceStatus("unavailable");
      }
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkHealth();
    };

    void checkHealth();
    const interval = window.setInterval(checkHealth, 15_000);
    window.addEventListener("online", checkHealth);
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", checkHealth);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);

  const sendTypingSignal = useCallback((active: boolean) => {
    if (!room || !clientId || !relayReady || room.status !== "active") return;
    const now = Date.now();
    if (active && now - lastTypingSignal.current < 800) return;
    if (active) lastTypingSignal.current = now;
    void requestJson(`/api/rooms/${room.id}/typing`, {
      method: "POST",
      headers: { Authorization: `Bearer ${clientId}` },
      body: JSON.stringify({ active }),
    }).catch(() => null);
  }, [clientId, relayReady, room?.id, room?.status]);

  const updateDraft = useCallback((value: string) => {
    setDraft(value);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    const active = value.trim().length > 0;
    sendTypingSignal(active);
    if (active) {
      typingTimeout.current = setTimeout(() => {
        sendTypingSignal(false);
        typingTimeout.current = null;
      }, 1_400);
    }
  }, [sendTypingSignal]);

  const acceptRoom = useCallback((
    nextRoom: RoomSnapshot | null,
    participantId: string,
    encryption?: ConversationEncryption,
  ) => {
    if (!nextRoom) return;
    setClientId(participantId);
    const nextConversations = saveLocalRoom(nextRoom, participantId, encryption);
    const local = nextConversations.find((item) => item.roomId === nextRoom.id);
    setConversations(nextConversations);
    setMessages(local?.messages ?? []);
    setRoom(nextRoom);
    setScreen(nextRoom.kind === "random" && nextRoom.status === "waiting" ? "matching" : "chat");
  }, []);

  const storeMessage = useCallback((roomId: string, message: ChatMessage) => {
    const next = saveLocalMessage(roomId, message);
    setConversations(next);
    setMessages(next.find((item) => item.roomId === roomId)?.messages ?? []);
  }, []);

  const startRandom = useCallback(async () => {
    const participantId = createParticipantId();
    setClientId(participantId);
    setBusy(true);
    setError("");
    setScreen("matching");
    try {
      const encryption = await ensureSigningCredentials(await createEcdhCredentials());
      const data = await requestJson<{ room: RoomSnapshot }>("/api/match", {
        method: "POST",
        headers: { Authorization: `Bearer ${participantId}` },
        body: JSON.stringify({
          publicKey: serializePublicKey(encryption),
          signingKey: serializeSigningKey(encryption),
        }),
      });
      acceptRoom(data.room, participantId, encryption);
    } catch {
      setError(t("findError"));
      setScreen("error");
    } finally {
      setBusy(false);
    }
  }, [acceptRoom, t]);

  const createPrivate = useCallback(async () => {
    const participantId = createParticipantId();
    const secret = createPrivateSecret();
    const encryption = await ensureSigningCredentials({ mode: "private", secret });
    setClientId(participantId);
    setBusy(true);
    setError("");
    try {
      const keyCommitment = await privateSecretCommitment(secret);
      const data = await requestJson<{ room: RoomSnapshot }>("/api/rooms", {
        method: "POST",
        headers: { Authorization: `Bearer ${participantId}` },
        body: JSON.stringify({
          signingKey: serializeSigningKey(encryption),
          keyCommitment,
        }),
      });
      acceptRoom(data.room, participantId, encryption);
      router.push(`/r/${data.room.id}#k=${secret}`);
    } catch {
      setError(t("privateError"));
      setScreen("error");
    } finally {
      setBusy(false);
    }
  }, [acceptRoom, router, t]);

  useEffect(() => {
    if (!storageReady || !initialRoomId || openedRoomId.current === initialRoomId) return;
    openedRoomId.current = initialRoomId;
    let cancelled = false;
    const existing = loadLocalConversations().find(
      (conversation) => conversation.roomId === initialRoomId,
    );
    const fragmentSecret = new URLSearchParams(window.location.hash.slice(1)).get("k");
    if (window.location.hash) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
    const encryption: ConversationEncryption | undefined =
      existing?.encryption ??
      (isValidPrivateSecret(fragmentSecret)
        ? { mode: "private", secret: fragmentSecret }
        : undefined);
    const participantId = existing?.clientId ?? createParticipantId();
    setClientId(participantId);

    const showLocalHistory = () => {
      if (!existing) return false;
      const localRoom: RoomSnapshot = {
        id: existing.roomId,
        kind: existing.kind,
        status: "ended",
        participantPublicId: existing.publicId ?? "",
        partnerPublicId: null,
        partnerPresent: false,
        partnerOnline: false,
        partnerPublicKey: null,
        partnerSigningKey: null,
        participantActive: false,
        createdAt: existing.createdAt,
      };
      const next = setLocalRoomStatus(existing.roomId, "ended");
      setConversations(next);
      setClientId(existing.clientId);
      setMessages(existing.messages);
      setRoom(localRoom);
      setScreen("chat");
      return true;
    };

    const openRoom = async () => {
      if (!encryption) {
        if (!showLocalHistory()) {
          setError(t("inviteError"));
          setScreen("error");
        }
        return;
      }
      const secureEncryption = await ensureSigningCredentials(encryption);
      if (existing) {
        setConversations(saveLocalEncryption(initialRoomId, secureEncryption));
      }
      try {
        const data = existing
          ? await requestJson<{ room: RoomSnapshot }>(
              `/api/rooms/${initialRoomId}/keys`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${participantId}` },
                body: JSON.stringify({
                  signingKey: serializeSigningKey(secureEncryption),
                }),
              },
            )
          : await requestJson<{ room: RoomSnapshot }>(`/api/rooms/${initialRoomId}/join`, {
              method: "POST",
              headers: { Authorization: `Bearer ${participantId}` },
              body: JSON.stringify({
                signingKey: serializeSigningKey(secureEncryption),
                keyCommitment:
                  secureEncryption.mode === "private"
                    ? await privateSecretCommitment(secureEncryption.secret)
                    : null,
              }),
            });
        if (!cancelled) acceptRoom(data.room, participantId, secureEncryption);
      } catch {
        if (cancelled) return;
        if (!showLocalHistory()) {
          setError(t("inviteError"));
          setScreen("error");
        }
      }
    };
    void openRoom();
    return () => { cancelled = true; };
    // Opening is room/storage scoped; locale changes must not claim another seat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptRoom, initialRoomId, storageReady]);

  useEffect(() => {
    if (screen !== "home" || !storageReady) return;
    let cancelled = false;
    const refreshStatuses = async () => {
      const local = loadLocalConversations();
      await Promise.all(
        local
          .filter((conversation) => conversation.status !== "ended")
          .map(async (conversation) => {
            try {
              const data = await requestJson<{ room: RoomSnapshot }>(
                `/api/rooms/${conversation.roomId}?touch=false`,
                { headers: { Authorization: `Bearer ${conversation.clientId}` } },
              );
              saveLocalRoom(data.room, conversation.clientId);
            } catch {
              setLocalRoomStatus(conversation.roomId, "ended");
            }
          }),
      );
      if (!cancelled) setConversations(loadLocalConversations());
    };
    void refreshStatuses();
    return () => { cancelled = true; };
  }, [screen, storageReady]);

  useEffect(() => {
    if (screen !== "matching" || !clientId) return;
    const poll = window.setInterval(async () => {
      try {
        const data = await requestJson<{ room: RoomSnapshot | null }>(
          "/api/match",
          { headers: { Authorization: `Bearer ${clientId}` } },
        );
        if (data.room) acceptRoom(data.room, clientId);
      } catch {
        // A temporary polling issue should not end the queue.
      }
    }, 1100);
    return () => window.clearInterval(poll);
  }, [acceptRoom, clientId, screen]);

  useEffect(() => {
    if (screen !== "chat" || !room || !clientId) return;
    const roomId = room.id;
    const poll = window.setInterval(async () => {
      try {
        const data = await requestJson<{ room: RoomSnapshot }>(
          `/api/rooms/${roomId}`,
          { headers: { Authorization: `Bearer ${clientId}` } },
        );
        setRoom(data.room);
        setConversations(saveLocalRoom(data.room, clientId));
      } catch {
        // Keep local history visible during brief connectivity drops.
      }
    }, 2500);
    return () => window.clearInterval(poll);
  }, [clientId, room?.id, screen]);

  useEffect(() => {
    if (screen !== "chat" || !room || !clientId || room.status === "ended") return;
    const roomSnapshot = room;
    const roomId = room.id;
    const abort = new AbortController();
    setRelayReady(false);

    const receiveMessage = async (data: string) => {
      try {
        const envelope = JSON.parse(data) as EncryptedMessageEnvelope;
        if (
          envelope.version !== 1 ||
          typeof envelope.id !== "string" ||
          typeof envelope.iv !== "string" ||
          typeof envelope.ciphertext !== "string" ||
          typeof envelope.signature !== "string" ||
          typeof envelope.senderPublicId !== "string" ||
          typeof envelope.createdAt !== "string"
        ) return;
        const conversation = loadLocalConversations().find(
          (item) => item.roomId === roomId,
        );
        const signatureKey = envelope.senderPublicId === roomSnapshot.participantPublicId
          ? serializeSigningKey(conversation?.encryption)
          : roomSnapshot.partnerSigningKey;
        const signatureValid = await verifyEnvelopeSignature(
          signatureKey,
          roomId,
          envelope,
        );
        if (!signatureValid) return;
        const key = await getRoomCryptoKey(conversation?.encryption, roomSnapshot);
        const body = await decryptMessage(key, roomId, envelope);
        storeMessage(roomId, {
          id: envelope.id,
          body,
          senderPublicId: envelope.senderPublicId,
          createdAt: envelope.createdAt,
        });
      } catch {
        // Authentication failure means wrong key or tampered ciphertext: fail closed.
      }
    };

    const handleBlock = (block: string) => {
      let eventType = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) eventType = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      const payload = data.join("\n");
      if (!payload) return;
      if (eventType === "message") void receiveMessage(payload);
      if (eventType === "peer") {
        try {
          const peer = JSON.parse(payload) as { connected?: boolean };
          setRelayReady(peer.connected === true);
          if (!peer.connected) setPartnerTyping(false);
        } catch {
          setRelayReady(false);
          setPartnerTyping(false);
        }
      }
      if (eventType === "typing") {
        try {
          const typing = JSON.parse(payload) as {
            senderPublicId?: string;
            active?: boolean;
          };
          if (typing.senderPublicId !== roomSnapshot.partnerPublicId) return;
          setPartnerTyping(typing.active === true);
          if (typingTimeout.current) clearTimeout(typingTimeout.current);
          if (typing.active) {
            typingTimeout.current = setTimeout(() => {
              setPartnerTyping(false);
              typingTimeout.current = null;
            }, 3_500);
          }
        } catch {
          setPartnerTyping(false);
        }
      }
    };

    const connect = async () => {
      while (!abort.signal.aborted) {
        try {
          const response = await fetch(`/api/rooms/${roomId}/events`, {
            headers: {
              Accept: "text/event-stream",
              Authorization: `Bearer ${clientId}`,
            },
            cache: "no-store",
            signal: abort.signal,
          });
          if (!response.ok || !response.body) throw new Error("Encrypted relay unavailable");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!abort.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
            if (buffer.length > 100_000) throw new Error("Relay frame overflow");
            let boundary = buffer.indexOf("\n\n");
            while (boundary >= 0) {
              handleBlock(buffer.slice(0, boundary));
              buffer = buffer.slice(boundary + 2);
              boundary = buffer.indexOf("\n\n");
            }
          }
        } catch {
          if (abort.signal.aborted) return;
        }
        setRelayReady(false);
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
    };

    void connect();
    return () => {
      setRelayReady(false);
      setPartnerTyping(false);
      if (typingTimeout.current) {
        clearTimeout(typingTimeout.current);
        typingTimeout.current = null;
      }
      abort.abort();
    };
  }, [clientId, room?.id, room?.partnerPublicKey, room?.status, screen, storeMessage]);

  const pauseRoom = useCallback(() => {
    openedRoomId.current = null;
    setRoom(null);
    setClientId("");
    setMessages([]);
    setDraft("");
    setScreen("home");
    router.push("/");
  }, [router]);

  const leaveRoom = useCallback(async (goHome = true) => {
    const currentRoom = room;
    if (currentRoom && clientId) {
      await requestJson(`/api/rooms/${currentRoom.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${clientId}` },
        body: JSON.stringify({}),
      }).catch(() => null);
      setConversations(setLocalRoomStatus(currentRoom.id, "ended"));
    }
    setRoom(null);
    setMessages([]);
    setDraft("");
    if (goHome) {
      setClientId("");
      setScreen("home");
      router.push("/");
    }
  }, [clientId, room, router]);

  const nextChat = useCallback(async () => {
    await leaveRoom(false);
    const participantId = createParticipantId();
    setClientId(participantId);
    setScreen("matching");
    setBusy(true);
    try {
      const encryption = await ensureSigningCredentials(await createEcdhCredentials());
      const data = await requestJson<{ room: RoomSnapshot }>("/api/match", {
        method: "POST",
        headers: { Authorization: `Bearer ${participantId}` },
        body: JSON.stringify({
          publicKey: serializePublicKey(encryption),
          signingKey: serializeSigningKey(encryption),
        }),
      });
      acceptRoom(data.room, participantId, encryption);
    } catch {
      setError(t("nextError"));
      setScreen("error");
    } finally {
      setBusy(false);
    }
  }, [acceptRoom, leaveRoom, t]);

  const cancelSearch = useCallback(async () => {
    await leaveRoom(true);
  }, [leaveRoom]);

  const sendMessage = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || !room || !clientId || !relayReady || !safetyCode || sending) return;
    sendTypingSignal(false);
    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current);
      typingTimeout.current = null;
    }
    setSending(true);
    setDraft("");
    try {
      const conversation = loadLocalConversations().find(
        (item) => item.roomId === room.id,
      );
      const key = await getRoomCryptoKey(conversation?.encryption, room);
      const encrypted = await encryptMessage(key, room.id, room.participantPublicId, body);
      const signature = await signEnvelope(conversation?.encryption, room.id, encrypted);
      const envelope: EncryptedMessageEnvelope = { ...encrypted, signature };
      await requestJson<{ envelope: EncryptedMessageEnvelope }>(`/api/rooms/${room.id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${clientId}` },
        body: JSON.stringify({ envelope }),
      });
      storeMessage(room.id, {
        id: envelope.id,
        body,
        senderPublicId: room.participantPublicId,
        createdAt: envelope.createdAt,
      });
    } catch {
      setDraft(body);
      setError(t("sendError"));
    } finally {
      setSending(false);
    }
  }, [clientId, draft, relayReady, room, safetyCode, sendTypingSignal, sending, storeMessage, t]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const copyInvite = async () => {
    if (!room) return;
    const conversation = loadLocalConversations().find(
      (item) => item.roomId === room.id,
    );
    const secret = conversation?.encryption?.mode === "private"
      ? conversation.encryption.secret
      : null;
    if (room.kind === "private" && !secret) return;
    const url = `${window.location.origin}/r/${room.id}${secret ? `#k=${secret}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement("textarea");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  const openLocalChat = useCallback((conversation: LocalConversation) => {
    if (room?.id === conversation.roomId) return;
    openedRoomId.current = null;
    setScreen("loading");
    const secret = conversation.encryption?.mode === "private"
      ? conversation.encryption.secret
      : null;
    router.push(`/r/${conversation.roomId}${secret ? `#k=${secret}` : ""}`);
  }, [room?.id, router]);

  if (screen === "loading" || (initialRoomId && !storageReady)) {
    return <div className="grid min-h-screen place-items-center bg-[#f8f6f0]" dir={getLanguageDirection(language)}><div className="text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#ff6747] text-white"><LoaderCircle className="animate-spin" size={22} /></div><p className="mt-4 text-[12px] font-bold text-[#77807d]">{t("openingInvite")}</p></div></div>;
  }

  if (screen === "error") {
    return <div className="min-h-screen bg-[#f8f6f0]" dir={getLanguageDirection(language)}><Header t={t} language={language} onLanguage={changeLanguage} /><main className="grid min-h-[calc(100vh-76px)] place-items-center px-5 pb-20"><div className="max-w-md text-center"><div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#fff0ea] text-[#ef6849]"><X size={28} /></div><h1 className="mt-6 text-[32px] font-extrabold tracking-[-0.05em] text-[#27322f]">{t("errorTitle")}</h1><p className="mt-3 text-[14px] leading-6 text-[#7d8582]">{error || t("errorRetry")}</p><button onClick={() => { setError(""); setRoom(null); setClientId(""); setScreen("home"); router.push("/"); }} className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#ff6747] px-6 py-2 text-[12px] font-extrabold text-white">{t("backToLuma")} <ArrowRight size={15} className="rtl:rotate-180" /></button></div></main></div>;
  }

  if (screen === "matching") return <MatchingScreen onCancel={cancelSearch} conversations={conversations} currentRoomId={room?.id} t={t} language={language} onLanguage={changeLanguage} onOpenChat={openLocalChat} />;

  if (screen === "chat" && room) {
    return <ChatScreen room={room} clientId={clientId} messages={messages} draft={draft} sending={sending} copied={copied} relayReady={relayReady} partnerTyping={partnerTyping} safetyCode={safetyCode} conversations={conversations} t={t} language={language} onLanguage={changeLanguage} onOpenChat={openLocalChat} onDraft={updateDraft} onSend={sendMessage} onKeyDown={handleKeyDown} onCopy={copyInvite} onPause={pauseRoom} onLeave={() => void leaveRoom(true)} onNext={() => void nextChat()} />;
  }

  return <HomeScreen onRandom={() => void startRandom()} onPrivate={() => void createPrivate()} busy={busy || !storageReady} serviceStatus={serviceStatus} conversations={conversations} t={t} language={language} onLanguage={changeLanguage} onOpenChat={openLocalChat} />;
}
