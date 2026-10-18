import "server-only";
import { nanoid } from "nanoid";
import { and, asc, desc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { matchmaking, rooms, users } from "@/db/schema";
import { publish } from "@/lib/bus";
import { HttpError } from "@/lib/request-security";
export const MATCH_LOCK = 908172635;
export const userScope = (id: string) => `user:${id}`;
export const strangerScope = (id: string) => `stranger:${id}`;
export const roomScope = (id: string) => `room:${id}`;

export async function getUserName(id: string) {
  const [user] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, id)).limit(1);
  return user?.name ?? null;
}
export async function getActiveStrangerSession(userId: string) {
  const [self] = await db.select().from(matchmaking).where(eq(matchmaking.userId, userId)).orderBy(desc(matchmaking.createdAt)).limit(1);
  if (!self?.sessionId) return null;
  const [peer] = await db.select().from(matchmaking).where(and(eq(matchmaking.sessionId, self.sessionId), ne(matchmaking.userId, userId))).limit(1);
  return { sessionId: self.sessionId, partnerId: peer?.userId ?? null, partnerIdentityPubKey: peer?.identityPubKey ?? null };
}

/** Entire queue transition is atomic and idempotent across tabs/workers. */
export async function findOrJoinQueue(userId: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MATCH_LOCK})`);
    await tx.delete(matchmaking).where(and(isNull(matchmaking.pairedAt), lt(matchmaking.createdAt, new Date(Date.now() - 600_000))));
    const mine = await tx.select().from(matchmaking).where(eq(matchmaking.userId, userId)).orderBy(desc(matchmaking.createdAt));
    let self = mine[0];
    // Repair only this user's duplicate legacy queue metadata, never transcripts.
    if (self && mine.length > 1) await tx.delete(matchmaking).where(and(eq(matchmaking.userId, userId), ne(matchmaking.id, self.id)));
    if (self?.sessionId) {
      const [peer] = await tx.select().from(matchmaking).where(and(eq(matchmaking.sessionId, self.sessionId), ne(matchmaking.userId, userId))).limit(1);
      return { sessionId: self.sessionId, partnerId: peer?.userId ?? null, newlyPaired: false };
    }
    if (!self) [self] = await tx.insert(matchmaking).values({ userId }).returning();
    const [peer] = await tx.select().from(matchmaking).where(and(isNull(matchmaking.pairedAt), ne(matchmaking.userId, userId))).orderBy(asc(matchmaking.createdAt)).limit(1);
    if (!peer) return null;
    const sessionId = nanoid();
    const pairedAt = new Date();
    await tx.update(matchmaking).set({ sessionId, pairedAt }).where(eq(matchmaking.id, self.id));
    await tx.update(matchmaking).set({ sessionId, pairedAt }).where(eq(matchmaking.id, peer.id));
    return { sessionId, partnerId: peer.userId, newlyPaired: true };
  });
}

export async function publishIdentity(userId: string, sessionId: string, key: string) {
  const peerId = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MATCH_LOCK})`);
    const [self] = await tx.select().from(matchmaking).where(and(eq(matchmaking.userId, userId), eq(matchmaking.sessionId, sessionId))).limit(1);
    if (!self) throw new HttpError(403, "Not a participant");
    if (self.identityPubKey && self.identityPubKey !== key) throw new HttpError(409, "Encryption key is already bound to this session");
    await tx.update(matchmaking).set({ identityPubKey: key }).where(eq(matchmaking.id, self.id));
    const [peer] = await tx.select().from(matchmaking).where(and(eq(matchmaking.sessionId, sessionId), ne(matchmaking.userId, userId))).limit(1);
    return peer?.userId;
  });
  if (peerId) publish(userScope(peerId), JSON.stringify({ type: "partner_key", sessionId, key }));
}

export async function leaveStrangerSession(userId: string, expected?: string) {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MATCH_LOCK})`);
    const [self] = await tx.select().from(matchmaking).where(eq(matchmaking.userId, userId)).limit(1);
    if (!self) return;
    if (expected && self.sessionId !== expected) throw new HttpError(409, "This tab is not in that session");
    await tx.delete(matchmaking).where(eq(matchmaking.userId, userId));
    if (self.sessionId) {
      const [peer] = await tx.select().from(matchmaking).where(eq(matchmaking.sessionId, self.sessionId)).limit(1);
      if (peer) publish(userScope(peer.userId), JSON.stringify({ type: "partner_left", sessionId: self.sessionId }));
      publish(userScope(userId), JSON.stringify({ type: "partner_left", sessionId: self.sessionId }));
      publish(strangerScope(self.sessionId), JSON.stringify({ type: "session_ended", sessionId: self.sessionId }));
    }
  });
}

export async function closeRoom(id: string, userId: string) {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`room:${id}`}))`);
    const [room] = await tx.select().from(rooms).where(eq(rooms.id, id)).limit(1);
    if (!room) throw new HttpError(404, "Room not found");
    if (room.hostUserId !== userId && room.joinedUserId !== userId) throw new HttpError(403, "Not a participant");
    await tx.update(rooms).set({ closedAt: new Date() }).where(eq(rooms.id, id));
    publish(roomScope(id), JSON.stringify({ type: "room_closed" }));
  });
}
