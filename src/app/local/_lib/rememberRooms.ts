// Browser-side storage of "rooms I've been in recently". Used by the
// home page to render a chat history column (à la ChatGPT / Mistral).
//
// We intentionally store *ids, labels, and previews* on the client only;
// messages themselves stay in the database (server chats) or in a
// separate localStorage bucket (local chats). The history column is
// purely a navigation aid — clicking an entry re-opens the chat.

export type RememberedKind = "stranger" | "room" | "local";

export type RememberedRoom = {
  id: string;
  kind: RememberedKind;
  /** Human-readable label. For strangers, the partner's display name
   * if known; for rooms, the invite code or "Private room"; for local
   * chats, the room key. */
  title: string;
  /** Last message preview (truncated to ~80 chars). */
  preview?: string;
  /** Sender name for the last message. */
  previewFrom?: string;
  /** Last message timestamp (ms epoch). */
  ts: number;
  /** True when the chat is still considered active/open. For local
   * chats, the tab still has the room open in this browser; for
   * strangers, the matchmaking table still has a live session; for
   * rooms, the room hasn't been closed. */
  active?: boolean;
  /** Number of unread messages since the user last visited the chat. */
  unread?: number;
  /** Client-only private-room key, never sent to the server. */
  key?: string;
};

const KEY = "chatterbox.local.rooms";
const SEEN_KEY = "chatterbox.local.seen";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function rememberRoom(entry: Omit<RememberedRoom, "ts">): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: Record<string, RememberedRoom> = safeParse(raw) ?? {};
    parsed[entry.id] = {
      ...entry,
      ts: Date.now(),
    };
    window.localStorage.setItem(KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

/**
 * Update a remembered room, preserving its previous `ts` if the entry
 * already existed (so the sort order is stable and only "real" visits
 * bump it). Useful for cheap preview updates from the chat page.
 */
export function touchRoom(
  id: string,
  patch: Partial<Omit<RememberedRoom, "id">>,
): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: Record<string, RememberedRoom> = safeParse(raw) ?? {};
    const existing = parsed[id];
    if (!existing) return;
    parsed[id] = {
      ...existing,
      ...patch,
      id,
      ts: patch.ts ?? existing.ts,
    };
    window.localStorage.setItem(KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

export function forgetRoom(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = safeParse<Record<string, RememberedRoom>>(raw);
    if (!parsed) return;
    delete parsed[id];
    window.localStorage.setItem(KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

export function listRememberedRooms(): RememberedRoom[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = safeParse<Record<string, RememberedRoom>>(raw);
    if (!parsed) return [];
    return Object.values(parsed).sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

export function clearRememberedRooms(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(SEEN_KEY);
  } catch {
    // ignore
  }
}

/** Last time the user actually opened a chat (ms epoch). */
export function markSeen(roomId: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed: Record<string, number> = safeParse(raw) ?? {};
    parsed[roomId] = Date.now();
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

export function getSeen(roomId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed = safeParse<Record<string, number>>(raw);
    return parsed?.[roomId] ?? 0;
  } catch {
    return 0;
  }
}