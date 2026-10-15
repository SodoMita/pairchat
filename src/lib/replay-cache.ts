type ReplayRegistry = Map<string, Map<string, number>>;

const globalForReplayCache = globalThis as typeof globalThis & {
  __lumaReplayCache?: ReplayRegistry;
};

const registry = globalForReplayCache.__lumaReplayCache ?? new Map<string, Map<string, number>>();
globalForReplayCache.__lumaReplayCache = registry;

export function claimMessageId(roomId: string, messageId: string) {
  const now = Date.now();
  const expiresAt = now + 30 * 60_000;
  const room = registry.get(roomId) ?? new Map<string, number>();

  if (room.size > 1_000) {
    for (const [id, expiry] of room) {
      if (expiry <= now) room.delete(id);
    }
  }
  if (room.has(messageId)) return false;
  room.set(messageId, expiresAt);
  registry.set(roomId, room);
  return true;
}
