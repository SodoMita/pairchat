"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  rememberRoom as rememberRoomShared,
  forgetRoom as forgetRoomShared,
} from "./rememberRooms";
import { updatePreview } from "./touchPreview";

/**
 * Local-only chat hook — no server, no DB. Messages live in
 * `localStorage` (per-browser persistence) and are synced between tabs
 * on the same origin via `BroadcastChannel`. Multiple tabs on the same
 * machine can chat using the same room key. Tabs across different
 * machines/browsers cannot (that's the privacy model).
 *
 * - Each tab has its own identity stored under `tuner_identity_<tabId>`
 *   in `localStorage`. Reopening the same tab keeps the same identity.
 * - Messages are stored under `tuner_msgs_<roomId>` as an array; the
 *   hook reconciles by message id so out-of-order arrivals converge.
 * - A heartbeat pings the channel every 4s and presence dies after 12s
 *   of silence. The set of live tab ids is in `liveTabIds`.
 *
 * Returns the local message list, self identity, live peer ids, send
 * helpers, and a clear-history function.
 */

export type LocalMessage = {
  id: string;
  tabId: string;
  senderName: string;
  body: string;
  ts: number;
};

type WireMsg =
  | { kind: "msg"; m: LocalMessage }
  | { kind: "hello"; tabId: string; name: string }
  | { kind: "bye"; tabId: string }
  | { kind: "ping"; tabId: string; name: string; ts: number }
  | { kind: "request-state"; from: string }
  | { kind: "state-snapshot"; from: string; to: string; messages: LocalMessage[] };

const LS_PREFIX_MSGS = "chatterbox.local.msgs.";
const LS_PREFIX_IDENTITY = "chatterbox.local.identity.";
const LS_PREFIX_KNOWN_ROOMS = "chatterbox.local.rooms";
const MAX_TABS_PER_ROOM = 8;
const HEARTBEAT_MS = 4000;
const PEER_TIMEOUT_MS = 12000;

const NAME_ADJECTIVES = [
  "Sleek", "Calm", "Witty", "Brave", "Loyal", "Merry", "Steady", "Sunny",
  "Mellow", "Plucky", "Cosmic", "Jolly", "Cheery", "Zesty", "Bold", "Cosy",
];
const NAME_ANIMALS = [
  "otter", "panda", "fox", "wolf", "hawk", "lynx", "whale", "heron",
  "raven", "gecko", "badger", "moose", "beaver", "lemur", "yak", "ibis",
];

function pickName(): string {
  const a = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const n = NAME_ANIMALS[Math.floor(Math.random() * NAME_ANIMALS.length)];
  return `${a} ${n}`;
}

function randomTabId(): string {
  // 16 hex chars, no dashes — short, opaque, and stable across reload.
  const arr = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i += 1) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function loadMessages(roomId: string): LocalMessage[] {
  try {
    const raw = localStorage.getItem(LS_PREFIX_MSGS + roomId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isLocalMessage) : [];
  } catch {
    return [];
  }
}

function saveMessages(roomId: string, msgs: LocalMessage[]) {
  try {
    localStorage.setItem(LS_PREFIX_MSGS + roomId, JSON.stringify(msgs));
  } catch {
    // ignore
  }
}

function isLocalMessage(x: unknown): x is LocalMessage {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as LocalMessage).id === "string" &&
    typeof (x as LocalMessage).tabId === "string" &&
    typeof (x as LocalMessage).senderName === "string" &&
    typeof (x as LocalMessage).body === "string" &&
    typeof (x as LocalMessage).ts === "number"
  );
}

function loadIdentity(tabId: string): { tabId: string; name: string } {
  try {
    const raw = localStorage.getItem(LS_PREFIX_IDENTITY + tabId);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.tabId === "string" &&
        typeof parsed.name === "string"
      ) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  const fresh = { tabId, name: pickName() };
  try {
    localStorage.setItem(LS_PREFIX_IDENTITY + tabId, JSON.stringify(fresh));
  } catch {
    // ignore
  }
  return fresh;
}

export { rememberRoom, forgetRoom, listRememberedRooms, clearRememberedRooms } from "./rememberRooms";

export function useLocalChat(roomId: string) {
  const tabIdRef = useRef<string>("");
  if (!tabIdRef.current) tabIdRef.current = randomTabId();

  const [self, setSelf] = useState<{ tabId: string; name: string } | null>(
    null,
  );
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [liveTabIds, setLiveTabIds] = useState<Set<string>>(new Set());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const peersRef = useRef<Map<string, { name: string; lastSeen: number }>>(
    new Map(),
  );

  // Load identity + initial messages.
  useEffect(() => {
    setSelf(loadIdentity(tabIdRef.current));
    setMessages(loadMessages(roomId));
    rememberRoomShared({
      id: roomId,
      kind: "local",
      title: `Local · ${roomId}`,
      active: true,
    });
  }, [roomId]);

  // Open BroadcastChannel and broadcast presence.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(`chatterbox:local:${roomId}`);
    channelRef.current = bc;

    const send = (msg: WireMsg) => {
      try {
        bc.postMessage(msg);
      } catch {
        // ignore
      }
    };

    const myId = tabIdRef.current;
    const myName = self?.name ?? "Anonymous";

    send({ kind: "hello", tabId: myId, name: myName });
    send({ kind: "request-state", from: myId });
    peersRef.current.set(myId, { name: myName, lastSeen: Date.now() });

    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as WireMsg;
      if (!msg || typeof msg !== "object") return;
      if (msg.kind === "msg") {
        if (msg.m.tabId === myId) return;
        setMessages((prev) => {
          if (prev.some((p) => p.id === msg.m.id)) return prev;
          const next = [...prev, msg.m].sort((a, b) => a.ts - b.ts);
          saveMessages(roomId, next);
          updatePreview(roomId, msg.m.body, msg.m.senderName, msg.m.ts);
          return next;
        });
        peersRef.current.set(msg.m.tabId, {
          name: msg.m.senderName,
          lastSeen: Date.now(),
        });
      } else if (msg.kind === "hello" || msg.kind === "ping") {
        if (msg.tabId === myId) return;
        peersRef.current.set(msg.tabId, {
          name: msg.name,
          lastSeen: Date.now(),
        });
        setLiveTabIds(new Set(peersRef.current.keys()));
        if (msg.kind === "ping") {
          // Reply with our own hello so newcomers can learn our name.
          send({ kind: "hello", tabId: myId, name: myName });
        }
      } else if (msg.kind === "bye") {
        peersRef.current.delete(msg.tabId);
        setLiveTabIds(new Set(peersRef.current.keys()));
      } else if (msg.kind === "request-state") {
        send({
          kind: "state-snapshot",
          from: myId,
          to: msg.from,
          messages: loadMessages(roomId),
        });
      } else if (msg.kind === "state-snapshot") {
        if (msg.to !== myId) return;
        setMessages((prev) => {
          const merged = mergeById(prev, msg.messages);
          saveMessages(roomId, merged);
          return merged;
        });
      }
    };
    bc.addEventListener("message", onMessage);

    const heartbeat = setInterval(() => {
      send({ kind: "ping", tabId: myId, name: myName, ts: Date.now() });
      // Garbage-collect stale peers.
      const now = Date.now();
      let changed = false;
      for (const [id, p] of peersRef.current) {
        if (id === myId) continue;
        if (now - p.lastSeen > PEER_TIMEOUT_MS) {
          peersRef.current.delete(id);
          changed = true;
        }
      }
      if (changed) setLiveTabIds(new Set(peersRef.current.keys()));
    }, HEARTBEAT_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      bc.removeEventListener("message", onMessage);
      try {
        send({ kind: "bye", tabId: myId });
      } catch {
        // ignore
      }
      bc.close();
      channelRef.current = null;
    };
    window.addEventListener("beforeunload", cleanup);
    return cleanup;
  }, [roomId, self]);

  // Stable send function.
  const send = useCallback(
    (body: string) => {
      if (!self) return;
      const text = body.trim();
      if (!text) return;
      if (peersRef.current.size >= MAX_TABS_PER_ROOM) return;
      const m: LocalMessage = {
        id: `${self.tabId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tabId: self.tabId,
        senderName: self.name,
        body: text.slice(0, 2000),
        ts: Date.now(),
      };
      setMessages((prev) => {
        const next = [...prev, m].sort((a, b) => a.ts - b.ts);
        saveMessages(roomId, next);
        updatePreview(roomId, m.body, m.senderName, m.ts);
        return next;
      });
      const ch = channelRef.current;
      if (ch) {
        try {
          ch.postMessage({ kind: "msg", m } satisfies WireMsg);
        } catch {
          // ignore
        }
      }
    },
    [self, roomId],
  );

  const clearHistory = useCallback(() => {
    try {
      localStorage.removeItem(LS_PREFIX_MSGS + roomId);
    } catch {
      // ignore
    }
    forgetRoomShared(roomId);
    setMessages([]);
  }, [roomId]);

  // Excluding self from "live peers" count (we count other tabs).
  const peerCount = Math.max(0, liveTabIds.size - 1);
  const roomFull = liveTabIds.size >= MAX_TABS_PER_ROOM;

  return {
    self,
    messages,
    peerCount,
    liveCount: liveTabIds.size,
    roomFull,
    send,
    clearHistory,
    renameSelf: (name: string) => {
      const id = tabIdRef.current;
      const next = { tabId: id, name: name.trim() || pickName() };
      try {
        localStorage.setItem(LS_PREFIX_IDENTITY + id, JSON.stringify(next));
      } catch {
        // ignore
      }
      setSelf(next);
      const ch = channelRef.current;
      if (ch) {
        try {
          ch.postMessage({
            kind: "hello",
            tabId: id,
            name: next.name,
          } satisfies WireMsg);
        } catch {
          // ignore
        }
      }
    },
  };
}

function mergeById(a: LocalMessage[], b: LocalMessage[]): LocalMessage[] {
  const map = new Map<string, LocalMessage>();
  for (const m of a) map.set(m.id, m);
  for (const m of b) map.set(m.id, m);
  return Array.from(map.values()).sort((x, y) => x.ts - y.ts);
}