// Helper to update the "last preview" of a remembered room without
// touching its `ts` (so the sort order is preserved). Used by the chat
// windows to keep the history sidebar fresh while a chat is active.

import { touchRoom } from "./rememberRooms";

const MAX_PREVIEW = 80;

export function updatePreview(
  roomId: string,
  preview: string,
  previewFrom: string,
  ts: number,
): void {
  const trimmed = preview.replace(/\s+/g, " ").trim();
  const clipped =
    trimmed.length > MAX_PREVIEW
      ? trimmed.slice(0, MAX_PREVIEW - 1) + "…"
      : trimmed;
  touchRoom(roomId, {
    preview: clipped,
    previewFrom,
    ts,
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("chatterbox:history-updated"));
  }
}