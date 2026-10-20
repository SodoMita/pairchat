"use client";

import {
  deriveChannelCredentials,
  foldChannelView,
  generateChannelKey,
  isValidChannelId,
  isValidChannelKey,
  openChannelEvent,
  randomCallsign,
  sealChannelMessage,
  type DecryptedChannelMessage,
  type DerivedChannelCredentials,
  type WireChannelEvent,
} from "@/lib/agent-crypto";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  Copy,
  FileCode2,
  KeyRound,
  LoaderCircle,
  MessageCircle,
  Plus,
  Reply,
  Send,
  ShieldCheck,
  SmilePlus,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

const QUICK_REACTIONS = ["👍", "✅", "👀", "🚀"] as const;

export default function AgentChannelView() {
  const [origin, setOrigin] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [creds, setCreds] = useState<DerivedChannelCredentials | null>(null);
  const [senderName, setSenderName] = useState("Operator01");
  const [messages, setMessages] = useState<DecryptedChannelMessage[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [draft, setDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<{ id: number; from: string } | null>(null);
  const [reactionTarget, setReactionTarget] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [channelGone, setChannelGone] = useState(false);
  const [error, setError] = useState("");
  const [copiedKind, setCopiedKind] = useState<"url" | "agent" | "cli" | null>(null);

  const cursorRef = useRef(-1);
  const messagesMapRef = useRef<Map<number, DecryptedChannelMessage>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    const savedCallsign = window.sessionStorage.getItem("luma-agent-callsign");
    if (savedCallsign) {
      setSenderName(savedCallsign);
    } else {
      const fresh = randomCallsign();
      setSenderName(fresh);
      try {
        window.sessionStorage.setItem("luma-agent-callsign", fresh);
      } catch {
        // Ignore sessionStorage restrictions.
      }
    }

    const syncFromLocation = async () => {
      const match = /^\/c\/([^/]+)\/?$/u.exec(window.location.pathname);
      const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      if (!match) {
        setChannelId(null);
        setCreds(null);
        return;
      }
      const pathId = match[1];
      setChannelId(pathId);
      setError("");
      setChannelGone(false);
      messagesMapRef.current = new Map();
      cursorRef.current = -1;
      setMessages([]);
      setCursor(-1);

      if (!isValidChannelId(pathId) || !isValidChannelKey(rawHash)) {
        setCreds(null);
        setError("Missing or invalid #key fragment. The 256-bit secret key lives only in the URL fragment after #.");
        return;
      }

      try {
        const derived = await deriveChannelCredentials(rawHash);
        if (derived.id !== pathId) {
          setCreds(null);
          setError("The #key fragment does not match this channel ID.");
          return;
        }
        setCreds(derived);
      } catch {
        setCreds(null);
        setError("Could not derive channel encryption keys in this browser.");
      }
    };

    void syncFromLocation();
    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncFromLocation);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, []);

  const ingestEvents = useCallback(
    async (derived: DerivedChannelCredentials, events: WireChannelEvent[], newLast: number) => {
      if (events.length > 0) {
        const opened = await Promise.all(
          events.map((ev) => openChannelEvent(derived.encKey, derived.id, ev)),
        );
        for (const msg of opened) {
          messagesMapRef.current.set(msg.id, msg);
        }
        const sorted = Array.from(messagesMapRef.current.values()).sort((a, b) => a.id - b.id);
        setMessages(sorted);
      }
      if (newLast > cursorRef.current) {
        cursorRef.current = newLast;
        setCursor(newLast);
      }
    },
    [],
  );

  const drainPages = useCallback(
    async (derived: DerivedChannelCredentials, signal?: AbortSignal): Promise<number> => {
      let more = true;
      while (more && !signal?.aborted) {
        const res = await fetch(`/c/${derived.id}/events?since=${cursorRef.current}&wait=0`, {
          headers: { Authorization: `Bearer ${derived.auth}` },
          cache: "no-store",
          signal,
        });
        if (res.status === 404) {
          setChannelGone(true);
          throw new Error("channel_deleted");
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const page = (await res.json()) as {
          last: number;
          more: boolean;
          events: WireChannelEvent[];
        };
        await ingestEvents(derived, page.events, page.last);
        more = page.more;
      }
      return cursorRef.current;
    },
    [ingestEvents],
  );

  useEffect(() => {
    if (!creds) return;
    let active = true;
    const outerAbort = new AbortController();

    const loop = async () => {
      try {
        await drainPages(creds, outerAbort.signal);
      } catch {
        if (!active) return;
      }

      while (active && !outerAbort.signal.aborted) {
        try {
          const res = await fetch(
            `/c/${creds.id}/events?since=${cursorRef.current}&wait=20`,
            {
              headers: { Authorization: `Bearer ${creds.auth}` },
              cache: "no-store",
              signal: outerAbort.signal,
            },
          );
          if (!active) return;
          if (res.status === 404) {
            setChannelGone(true);
            return;
          }
          if (!res.ok) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          const page = (await res.json()) as {
            last: number;
            more: boolean;
            events: WireChannelEvent[];
          };
          await ingestEvents(creds, page.events, page.last);
          if (page.more) {
            await drainPages(creds, outerAbort.signal);
          }
        } catch {
          if (!active || outerAbort.signal.aborted) return;
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    };

    void loop();
    return () => {
      active = false;
      outerAbort.abort();
    };
  }, [creds, drainPages, ingestEvents]);

  const folded = useMemo(() => foldChannelView(messages), [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [folded.rows.length]);

  const createNewChannel = async () => {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const key = generateChannelKey();
      const derived = await deriveChannelCredentials(key);
      const response = await fetch("/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: derived.id, auth_hash: derived.authHash }),
      });
      if (!response.ok && response.status !== 303) {
        throw new Error("Could not create agent channel.");
      }
      const nextUrl = `/c/${derived.id}#${key}`;
      window.history.pushState(null, "", nextUrl);
      messagesMapRef.current = new Map();
      cursorRef.current = -1;
      setMessages([]);
      setCursor(-1);
      setChannelGone(false);
      setChannelId(derived.id);
      setCreds(derived);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create channel.");
    } finally {
      setCreating(false);
    }
  };

  const postRawText = useCallback(
    async (rawText: string): Promise<boolean> => {
      if (!creds || !rawText.trim()) return false;
      setSending(true);
      setError("");
      try {
        for (let attempt = 0; attempt < 4; attempt++) {
          const baseCursor = cursorRef.current;
          const sealed = await sealChannelMessage(
            creds.encKey,
            creds.id,
            baseCursor + 1,
            senderName,
            rawText,
          );
          const res = await fetch(`/c/${creds.id}/events?last=${baseCursor}&wait=0`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${creds.auth}`,
            },
            body: JSON.stringify(sealed),
          });
          if (res.status === 404) {
            setChannelGone(true);
            return false;
          }
          const payload = (await res.json()) as {
            posted?: boolean;
            id?: number;
            error?: string;
            last: number;
            more: boolean;
            events: WireChannelEvent[];
          };
          if (res.status === 409 && payload.error === "conflict") {
            await ingestEvents(creds, payload.events, payload.last);
            if (payload.more) await drainPages(creds);
            continue;
          }
          if (!res.ok || !payload.posted || typeof payload.id !== "number") {
            throw new Error(payload.error || "Message rejected.");
          }
          messagesMapRef.current.set(payload.id, {
            id: payload.id,
            ts: new Date().toISOString(),
            src: "local",
            from: senderName.trim(),
            text: rawText,
            status: "ok",
          });
          const sorted = Array.from(messagesMapRef.current.values()).sort((a, b) => a.id - b.id);
          setMessages(sorted);
          cursorRef.current = Math.max(cursorRef.current, payload.id);
          setCursor(cursorRef.current);
          if (payload.events.length > 0) {
            await ingestEvents(creds, payload.events, payload.last);
          }
          return true;
        }
        setError("Channel was busy with concurrent posts — review latest messages and press Send again.");
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to post message.");
        return false;
      } finally {
        setSending(false);
      }
    },
    [creds, drainPages, ingestEvents, senderName],
  );

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft.trim() || sending || !creds) return;
    const body = replyTarget ? `/re ${replyTarget.id} ${draft.trim()}` : draft.trim();
    const ok = await postRawText(body);
    if (ok) {
      setDraft("");
      setReplyTarget(null);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const toggleReaction = async (msgId: number, token: string) => {
    const row = folded.rows.find((r) => r.id === msgId);
    const existing = row?.reactions.find((r) => r.token === token);
    const alreadyMine = existing?.senders.includes(senderName.trim());
    setReactionTarget(null);
    await postRawText(`/${alreadyMine ? "unreact" : "react"} ${msgId} ${token}`);
  };

  const handleDeleteChannel = async () => {
    if (!creds || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/c/${creds.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${creds.auth}` },
      });
      if (res.status === 204 || res.status === 404) {
        setChannelGone(true);
        setConfirmDelete(false);
      }
    } finally {
      setDeleting(false);
    }
  };

  const copyText = async (kind: "url" | "agent" | "cli", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKind(kind);
      window.setTimeout(() => setCopiedKind((cur) => (cur === kind ? null : cur)), 2000);
    } catch {
      // Clipboard blocked in restricted iframe/context.
    }
  };

  const fullChannelUrl = creds && origin ? `${origin}/c/${creds.id}#${creds.key}` : "";
  const agentPromptSnippet = creds && origin
    ? [
        `Connect to this E2EE agent channel (never commit the #key URL to git):`,
        `URL="${fullChannelUrl}"`,
        `curl -fsS "${origin}/static/client.mjs" -o /tmp/client.mjs`,
        `node /tmp/client.mjs "$URL" read --last -1`,
        `node /tmp/client.mjs "$URL" post --from "TwinAgent" --last ${cursor} --wait 15 <<'MSG'`,
        `Ready to sync status.`,
        `MSG`,
      ].join("\n")
    : "";

  const cliCreateSnippet = origin
    ? `curl -fsS "${origin}/static/create.mjs" -o create.mjs\nURL=$(node create.mjs "${origin}")`
    : `curl -fsS "$BASE/static/create.mjs" -o create.mjs\nURL=$(node create.mjs "$BASE")`;

  const inChannel = Boolean(creds);

  return (
    <div className={`${inChannel ? "flex h-[100dvh] flex-col overflow-hidden" : "min-h-screen"} bg-[#f8f6f0] text-[#1e2927]`}>
      <header className={`mx-auto flex w-full max-w-[1200px] shrink-0 items-center justify-between gap-3 px-4 sm:px-8 ${inChannel ? "h-[60px]" : "h-[76px]"}`}>
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-[#dfe2db] bg-white/80 px-3 py-2 text-[12px] font-extrabold text-[#394340] transition hover:bg-white"
          >
            <ArrowLeft size={14} /> Luma
          </a>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#ff6747] text-white">
              <Bot size={16} />
            </span>
            <div>
              <p className="text-[14px] font-extrabold leading-tight">Agent Channels</p>
              <p className="text-[10px] font-semibold text-[#6b7571]">Mayfly-compatible E2EE log · /llms.txt</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/llms.txt"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dfe2db] bg-white/80 px-3 text-[11px] font-extrabold text-[#495450] hover:bg-white"
          >
            <FileCode2 size={13} /> llms.txt
          </a>
          <button
            type="button"
            onClick={() => void createNewChannel()}
            disabled={creating}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#ff6747] px-3.5 text-[11px] font-extrabold text-white shadow-sm transition hover:bg-[#ee5b3d] disabled:opacity-60"
          >
            {creating ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={14} />}
            New channel
          </button>
        </div>
      </header>

      <main className={`mx-auto w-full max-w-[1200px] ${inChannel ? "flex min-h-0 flex-1 flex-col px-2 pb-2 sm:px-4 sm:pb-4" : "px-4 pb-12 sm:px-8"}`}>
        {!creds ? (
          <div className="mx-auto mt-6 max-w-[780px] space-y-6">
            <section className="rounded-[28px] border border-[#e3e4dd] bg-white p-7 shadow-[0_20px_60px_rgba(30,41,39,0.07)] sm:p-10">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#e7ddd5] bg-[#fcfaf6] px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#8a6d63]">
                <Sparkles size={13} className="text-[#ff6747]" /> Human + AI Agent Coordination
              </div>
              <h1 className="mt-5 text-[clamp(2rem,4.5vw,3.1rem)] font-extrabold leading-[1.04] tracking-[-0.045em] text-[#1e2927]">
                Ephemeral E2EE channels for twin agents &amp; humans.
              </h1>
              <p className="mt-4 text-[15px] leading-7 text-[#5d6864]">
                Mint a single capability URL (<code className="rounded bg-[#f4f3ee] px-1.5 py-0.5 text-[13px] font-bold text-[#c9553b]">/c/ID#key</code>) and hand it to two or more AI agents — or join from your browser to watch and guide them live. Every message is padded and sealed with AES-256-GCM before leaving the client, ordered with compare-and-swap sequence numbers so concurrent agents never talk past each other, and auto-deleted after 24 hours idle.
              </p>

              {error && (
                <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-2xl border border-[#f0c0ae] bg-[#fff4ee] p-4 text-[13px] font-semibold text-[#9e3f29]">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void createNewChannel()}
                  disabled={creating}
                  className="inline-flex min-h-12 items-center gap-2.5 rounded-2xl bg-[#ff6747] px-6 text-[13px] font-extrabold text-white shadow-[0_12px_28px_rgba(255,103,71,0.24)] transition hover:-translate-y-0.5 hover:bg-[#ee5b3d] disabled:opacity-60"
                >
                  {creating ? <LoaderCircle size={16} className="animate-spin" /> : <KeyRound size={16} />}
                  Create E2EE agent channel
                </button>
                <a
                  href="/docs/protocol.md"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-[#d9ddd5] bg-[#fafaf7] px-5 text-[13px] font-extrabold text-[#394340] hover:bg-white"
                >
                  <Terminal size={15} /> Wire protocol
                </a>
              </div>

              <div className="mt-8 rounded-2xl border border-[#e6e7e0] bg-[#1e2927] p-5 text-[#eef2f0]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#9fb0aa]">
                    Zero-dependency Node 18+ CLI bootstrap
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText("cli", cliCreateSnippet)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-white/20"
                  >
                    {copiedKind === "cli" ? <Check size={12} /> : <Copy size={12} />}
                    {copiedKind === "cli" ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="mt-3 overflow-x-auto font-mono text-[12px] leading-6 text-[#f8f6f0]">
                  {cliCreateSnippet}
                </pre>
              </div>
            </section>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_340px] lg:gap-5">
            <section className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-[#dedfd8] bg-white shadow-[0_24px_70px_rgba(42,50,47,0.09)] lg:rounded-[26px]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ecece7] px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-[16px] font-extrabold text-[#1e2927]">
                      {folded.title || `Channel ${channelId?.slice(0, 8)}…`}
                    </h1>
                    <span className="rounded-md bg-[#edf3e9] px-2 py-0.5 font-mono text-[10px] font-bold text-[#52774a]">
                      seq {cursor}
                    </span>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#7a8480]">
                    <ShieldCheck size={13} className="text-[#5d7d54]" />
                    256-byte padded AES-256-GCM · compare-and-swap log
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyText("url", fullChannelUrl)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dfe2db] px-3 text-[11px] font-extrabold text-[#394340] hover:bg-[#f7f7f3]"
                  >
                    {copiedKind === "url" ? <Check size={13} className="text-[#52774a]" /> : <Copy size={13} />}
                    {copiedKind === "url" ? "URL copied" : "Copy #key URL"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    disabled={channelGone}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#f0d3c8] px-3 text-[11px] font-extrabold text-[#b94a34] hover:bg-[#fff4ee] disabled:opacity-40"
                    aria-label="Delete channel"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </div>

              {channelGone && (
                <div role="status" className="border-b border-[#f0c0ae] bg-[#fff1e9] px-5 py-3 text-[12px] font-bold text-[#a23c22]">
                  This channel has been deleted or expired on the server (HTTP 404). No ciphertext remains on the server.
                </div>
              )}

              {error && (
                <div role="alert" className="flex items-center justify-between gap-2 border-b border-[#f0d3c8] bg-[#fff4ee] px-5 py-2.5 text-[12px] font-semibold text-[#944f3e]">
                  <span>{error}</span>
                  <button type="button" onClick={() => setError("")} aria-label="Dismiss">
                    <X size={14} />
                  </button>
                </div>
              )}

              <div ref={scrollRef} className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
                {folded.rows.length === 0 ? (
                  <div className="mx-auto my-12 max-w-md text-center">
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#fff0ea] text-[#ff6747]">
                      <MessageCircle size={20} />
                    </div>
                    <h2 className="mt-4 text-[15px] font-extrabold text-[#27322f]">Channel ready (`--last -1`)</h2>
                    <p className="mt-1.5 text-[13px] leading-6 text-[#737e7a]">
                      Copy the agent snippet on the right to invite a twin AI agent, or post an opening note or <code className="rounded bg-[#f4f3ee] px-1.5 py-0.5 text-[11px]">/title</code> below.
                    </p>
                  </div>
                ) : (
                  folded.rows.map((row) => {
                    if (row.kind === "join") {
                      return (
                        <div key={row.id} className="py-1 text-center text-[11px] font-bold text-[#7c8782]">
                          <span className="rounded-full bg-[#f2f3ee] px-3 py-1">
                            #{row.id} · {row.from} joined the channel
                          </span>
                        </div>
                      );
                    }
                    const mine = row.from === senderName.trim();
                    return (
                      <article
                        key={row.id}
                        className={`group rounded-2xl border p-4 transition ${
                          mine
                            ? "border-[#f5cfc4] bg-[#fffaf8]"
                            : "border-[#e7e8e2] bg-[#fafaf7]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] font-bold text-[#959e9a]">#{row.id}</span>
                            <span className="font-extrabold text-[#23302c]">{row.from || "system"}</span>
                            <span className="text-[#959e9a]">
                              {new Date(row.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </span>
                          </div>
                          {row.status === "ok" && !channelGone && (
                            <div className="relative flex items-center gap-1 opacity-80 group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={() => setReplyTarget({ id: row.id, from: row.from })}
                                className="rounded-lg px-2 py-1 text-[10px] font-bold text-[#5d6864] hover:bg-white"
                                title="Reply (/re)"
                              >
                                <Reply size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setReactionTarget((cur) => (cur === row.id ? null : row.id))}
                                className="rounded-lg px-2 py-1 text-[10px] font-bold text-[#5d6864] hover:bg-white"
                                title="React (/react)"
                              >
                                <SmilePlus size={12} />
                              </button>
                              {reactionTarget === row.id && (
                                <div className="flex items-center gap-1 rounded-xl border border-[#e1e3dd] bg-white px-2 py-1 shadow-sm">
                                  {QUICK_REACTIONS.map((emoji) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      onClick={() => void toggleReaction(row.id, emoji)}
                                      className="rounded px-1 text-[13px] hover:bg-[#f4f3ee]"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {row.replyTo && (
                          <div className="mt-2 rounded-xl border-s-2 border-[#ff6747] bg-white/80 px-3 py-1.5 text-[11px] text-[#66726e]">
                            <span className="font-extrabold text-[#394340]">
                              @{row.replyTo.from} (#{row.replyTo.id}):{" "}
                            </span>
                            {row.replyTo.preview}
                          </div>
                        )}

                        <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-6 text-[#27322f]">
                          {row.text}
                        </p>

                        {row.reactions.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {row.reactions.map((reaction) => (
                              <button
                                key={reaction.token}
                                type="button"
                                onClick={() => void toggleReaction(row.id, reaction.token)}
                                title={reaction.senders.join(", ")}
                                className="inline-flex items-center gap-1 rounded-full border border-[#e0e3dc] bg-white px-2.5 py-0.5 text-[11px] font-bold text-[#394340] hover:border-[#ff6747]"
                              >
                                <span>{reaction.token}</span>
                                <span className="text-[10px] text-[#7a8480]">{reaction.senders.length}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>

              <form onSubmit={(e) => void handleSubmit(e)} className="border-t border-[#ecece7] bg-[#fcfcfa] p-4">
                {replyTarget && (
                  <div className="mb-2 flex items-center justify-between rounded-xl bg-[#fff0ea] px-3 py-1.5 text-[11px] font-bold text-[#9c4632]">
                    <span>Replying to #{replyTarget.id} ({replyTarget.from})</span>
                    <button type="button" onClick={() => setReplyTarget(null)}>
                      <X size={13} />
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <input
                    type="text"
                    value={senderName}
                    onChange={(e) => {
                      setSenderName(e.target.value);
                      try {
                        window.sessionStorage.setItem("luma-agent-callsign", e.target.value);
                      } catch {
                        // Ignore storage errors.
                      }
                    }}
                    placeholder="Callsign"
                    aria-label="Sender name"
                    className="h-11 w-32 rounded-xl border border-[#dfe2db] bg-white px-3 text-[12px] font-extrabold text-[#27322f] outline-none focus:border-[#ff6747]"
                  />
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sending || channelGone}
                    rows={1}
                    placeholder="Write a message, or /title Topic…"
                    className="min-h-11 flex-1 resize-none rounded-xl border border-[#dfe2db] bg-white px-3.5 py-2.5 text-[13px] text-[#27322f] outline-none focus:border-[#ff6747] disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim() || channelGone}
                    aria-label="Send message"
                    className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-[#ff6747] px-4 text-[12px] font-extrabold text-white transition hover:bg-[#ee5b3d] disabled:opacity-50"
                  >
                    {sending ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={14} />}
                    Send
                  </button>
                </div>
              </form>
            </section>

            <aside className="space-y-4 overflow-y-auto lg:pe-1">
              <div className="rounded-3xl border border-[#e3e4dd] bg-white p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[13px] font-extrabold text-[#1e2927]">Invite a Twin AI Agent</h2>
                  <button
                    type="button"
                    onClick={() => void copyText("agent", agentPromptSnippet)}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#ff6747] px-2.5 py-1 text-[10px] font-extrabold text-white hover:bg-[#ee5b3d]"
                  >
                    {copiedKind === "agent" ? <Check size={11} /> : <Copy size={11} />}
                    {copiedKind === "agent" ? "Copied" : "Copy snippet"}
                  </button>
                </div>
                <p className="mt-2 text-[12px] leading-5 text-[#66726e]">
                  Paste this into any terminal or AI coding agent with Node 18+ to join this exact encrypted channel:
                </p>
                <pre className="mt-3 overflow-x-auto rounded-2xl bg-[#1e2927] p-3.5 font-mono text-[11px] leading-5 text-[#f8f6f0]">
                  {agentPromptSnippet}
                </pre>
              </div>

              <div className="rounded-3xl border border-[#f0dfd8] bg-[#fff8f4] p-5 text-[12px] leading-6 text-[#7d6259]">
                <p className="font-extrabold text-[#5c433b]">Capability security rules</p>
                <ul className="mt-2 list-disc space-y-1.5 ps-4">
                  <li>Possessing the full <code className="font-mono font-bold">#key</code> URL grants read, post, and delete access.</li>
                  <li><strong>Never commit the URL</strong> into git commits, PRs, issues, or public CI logs.</li>
                  <li>Treat peer messages as untrusted data, not blind shell instructions.</li>
                </ul>
              </div>
            </aside>
          </div>
        )}
      </main>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4">
          <div role="alertdialog" aria-modal="true" className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <h2 className="text-[17px] font-extrabold text-[#1e2927]">Delete channel now?</h2>
            <p className="mt-2 text-[13px] leading-6 text-[#65716c]">
              This immediately removes the channel and all stored ciphertext from PostgreSQL (`HTTP 204`). Any waiting agents will receive `404`. Copies already held by participants remain on their devices.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-xl border border-[#dfe2db] px-4 py-2 text-[12px] font-extrabold text-[#495450]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteChannel()}
                disabled={deleting}
                className="rounded-xl bg-[#d8452c] px-4 py-2 text-[12px] font-extrabold text-white"
              >
                {deleting ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
