import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { matchmaking, rooms, type User } from "@/db/schema";
import { MATCH_LOCK } from "@/lib/chat";
import { publish, subscriberCount } from "@/lib/bus";
import { HttpError, limit, readJson } from "@/lib/request-security";
import { MAX_ENVELOPE_BYTES, parseEnvelope, validScope, type WireMessage } from "@/lib/protocol";
const globals = globalThis as typeof globalThis & { __cbReplay?: Map<string, number> };
const replay = globals.__cbReplay ??= new Map<string, number>();
const MAX_AGE = 5 * 60_000;

export async function withAccess<T>(scope: string, userId: string, fn: (peerId: string | null, closed: boolean) => T, allowClosed = false) {
  if (!validScope(scope)) throw new HttpError(404, "Unknown conversation");
  return db.transaction(async tx => {
    if (scope.startsWith("room:")) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${scope}))`);
      const [room] = await tx.select().from(rooms).where(eq(rooms.id, scope.slice(5))).limit(1);
      if (!room) throw new HttpError(404, "Room not found");
      if (room.hostUserId !== userId && room.joinedUserId !== userId) throw new HttpError(403, "Not a participant");
      if (room.closedAt && !allowClosed) throw new HttpError(410, "Room closed");
      return fn(room.hostUserId === userId ? room.joinedUserId : room.hostUserId, !!room.closedAt);
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MATCH_LOCK})`);
    const sid = scope.slice(9);
    const [self] = await tx.select().from(matchmaking).where(and(eq(matchmaking.sessionId, sid), eq(matchmaking.userId, userId))).limit(1);
    if (!self) throw new HttpError(403, "Not a participant");
    const [peer] = await tx.select().from(matchmaking).where(and(eq(matchmaking.sessionId, sid), ne(matchmaking.userId, userId))).limit(1);
    if (!peer && !allowClosed) throw new HttpError(410, "Conversation ended");
    return fn(peer?.userId ?? null, !peer);
  });
}

/** Live-only fanout. There is deliberately NO database write or replay body. */
export async function relaySend(req: Request, user: User, scope: string) {
  limit(`messages:${user.id}`, 20, 2);
  const data = await readJson(req, MAX_ENVELOPE_BYTES + 512);
  if (Object.keys(data).join() !== "envelope" || typeof data.envelope !== "string") throw new HttpError(400, "Encrypted v2 envelope required");
  const e = parseEnvelope(data.envelope);
  if (!e || e.scope !== scope || e.sender !== user.id) throw new HttpError(400, "Invalid envelope context");
  const age = Date.now() - Date.parse(e.createdAt);
  if (age > MAX_AGE || age < -60_000) throw new HttpError(400, "Message timestamp expired");
  return withAccess(scope, user.id, (peerId) => {
    if (!peerId || subscriberCount(scope, user.id) === 0) throw new HttpError(409, "Peer is offline. Message was not sent.");
    const now = Date.now();
    for (const [id, expiry] of replay) if (expiry <= now) replay.delete(id);
    const id = `${scope}:${e.id}`;
    if (replay.has(id)) throw new HttpError(409, "Duplicate message");
    if (replay.size >= 50_000) throw new HttpError(503, "Relay busy");
    replay.set(id, Date.parse(e.createdAt) + MAX_AGE + 60_000);
    const message: WireMessage = { id: e.id, scope, senderUserId: user.id, senderName: user.displayName, body: JSON.stringify(e), createdAt: e.createdAt, systemFlag: false };
    publish(scope, JSON.stringify({ type: "message", message }));
    return Response.json({ message, relayAccepted: true }, { status: 202 });
  });
}
