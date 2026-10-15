import "server-only";
import { nanoid } from "nanoid";
import { and, asc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  matchmaking,
  messages,
  rooms,
  type Message,
  type Room,
} from "@/db/schema";

export type StrangerScope = `stranger:${string}`;
export type RoomScope = `room:${string}`;

/**
 * Try to pair the user with a waiting stranger. If no one is waiting,
 * put the user in the queue and return `null`. Returns the session id
 * either way so the client knows how to subscribe to messages.
 *
 * Also cleans up stale unpaired rows older than 10 minutes.
 *
 * If `identityPubKey` is provided, it's stored on the user's queue
 * row so the eventual partner can read it. The server can't decrypt
 * anything with this key — it's just a public key for ECDH.
 */
export async function findOrJoinQueue(
  userId: string,
  identityPubKey: string | null = null,
): Promise<{ sessionId: string; partnerId: string } | null> {
  // Sweep stale entries (left > 10 min ago, never paired).
  await db
    .delete(matchmaking)
    .where(
      and(
        isNull(matchmaking.pairedAt),
        lt(matchmaking.createdAt, sql`now() - interval '10 minutes'`),
      ),
    );

  // Look for a waiting partner that isn't us.
  const waiting = await db
    .select()
    .from(matchmaking)
    .where(and(isNull(matchmaking.pairedAt), ne(matchmaking.userId, userId)))
    .orderBy(asc(matchmaking.createdAt))
    .limit(1);

  const partner = waiting[0];

  if (partner) {
    const sessionId = nanoid();
    const now = sql`now()`;
    await db
      .update(matchmaking)
      .set({ pairedAt: now, sessionId })
      .where(eq(matchmaking.id, partner.id));
    // Reuse any existing unpaired row for this user (e.g., one created by
    // a prior PATCH that published an identity pub key). If none, insert.
    const existingSelf = await db
      .select()
      .from(matchmaking)
      .where(
        and(eq(matchmaking.userId, userId), isNull(matchmaking.pairedAt)),
      )
      .limit(1);
    let meRow: typeof existingSelf[number] | undefined;
    if (existingSelf.length > 0) {
      const setValues: { pairedAt: typeof now; sessionId: string; identityPubKey?: string } = {
        pairedAt: now,
        sessionId,
      };
      // Only overwrite the pub key if the caller provided one — never
      // clobber a previously-published key with NULL.
      if (identityPubKey) setValues.identityPubKey = identityPubKey;
      const [updated] = await db
        .update(matchmaking)
        .set(setValues)
        .where(eq(matchmaking.id, existingSelf[0].id))
        .returning();
      meRow = updated;
    } else {
      const [inserted] = await db
        .insert(matchmaking)
        .values({
          userId,
          sessionId,
          pairedAt: now,
          identityPubKey,
        })
        .returning();
      meRow = inserted;
    }
    if (!meRow) throw new Error("Failed to insert/update matchmaking row");
    return { sessionId, partnerId: partner.userId };
  }

  // Nobody waiting — reuse our existing unpaired row if any, else insert.
  const existingSelf = await db
    .select()
    .from(matchmaking)
    .where(and(eq(matchmaking.userId, userId), isNull(matchmaking.pairedAt)))
    .limit(1);
  if (existingSelf.length > 0) {
    // Only update the pub key if the caller actually provided one.
    // Otherwise we'd overwrite a previously-published key with NULL.
    if (identityPubKey) {
      await db
        .update(matchmaking)
        .set({ identityPubKey })
        .where(eq(matchmaking.id, existingSelf[0].id));
    }
  } else {
    await db.insert(matchmaking).values({ userId, identityPubKey });
  }
  return null;
}

export async function getActiveStrangerSession(
  userId: string,
): Promise<{
  sessionId: string;
  partnerId: string | null;
  partnerIdentityPubKey: string | null;
} | null> {
  const rows = await db
    .select()
    .from(matchmaking)
    .where(eq(matchmaking.userId, userId))
    .orderBy(asc(matchmaking.createdAt));

  // Most recent paired row wins.
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.sessionId && row.pairedAt) {
      const partnerRows = await db
        .select()
        .from(matchmaking)
        .where(
          and(
            eq(matchmaking.sessionId, row.sessionId),
            ne(matchmaking.userId, userId),
          ),
        )
        .limit(1);
      const partner = partnerRows[0];
      return {
        sessionId: row.sessionId,
        partnerId: partner?.userId ?? null,
        partnerIdentityPubKey: partner?.identityPubKey ?? null,
      };
    }
  }
  return null;
}

export async function leaveStrangerSession(userId: string): Promise<void> {
  await db.delete(matchmaking).where(eq(matchmaking.userId, userId));
}

/**
 * Post a chat message. `scope` is either "stranger:<sessionId>" or
 * "room:<roomId>".
 *
 * `body` is expected to be the encrypted envelope JSON (or a system
 * message plaintext). The server stores it verbatim — it cannot
 * decrypt it without the symmetric key, which lives only in the
 * participants' browsers.
 *
 * `senderPubKey` is the sender's per-message ephemeral X25519 public
 * key, base64url-encoded. It's used by the receiver to recompute the
 * AES key. For room messages this is null.
 */
export async function postMessage(params: {
  scope: string;
  senderUserId: string;
  senderName: string;
  body: string;
  senderPubKey?: string | null;
  system?: boolean;
}): Promise<Message> {
  const [row] = await db
    .insert(messages)
    .values({
      scope: params.scope,
      senderUserId: params.senderUserId,
      senderName: params.senderName,
      body: params.body,
      senderPubKey: params.senderPubKey ?? null,
      systemFlag: params.system ?? false,
    })
    .returning();
  if (!row) throw new Error("Failed to insert message");
  return row;
}

export async function listMessages(
  scope: string,
  since?: Date,
): Promise<Message[]> {
  if (since) {
    return db
      .select()
      .from(messages)
      .where(and(eq(messages.scope, scope), sql`${messages.createdAt} > ${since}`))
      .orderBy(asc(messages.createdAt));
  }
  return db
    .select()
    .from(messages)
    .where(eq(messages.scope, scope))
    .orderBy(asc(messages.createdAt));
}

export async function findRoomByInviteCode(code: string): Promise<Room | null> {
  const rows = await db
    .select()
    .from(rooms)
    .where(eq(rooms.inviteCode, code))
    .limit(1);
  return rows[0] ?? null;
}

export async function findRoomById(id: string): Promise<Room | null> {
  const rows = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function closeRoom(id: string): Promise<void> {
  await db
    .update(rooms)
    .set({ closedAt: sql`now()` })
    .where(eq(rooms.id, id));
}

export function strangerScope(sessionId: string): StrangerScope {
  return `stranger:${sessionId}`;
}

export function roomScope(roomId: string): RoomScope {
  return `room:${roomId}`;
}

/**
 * Returns the partner display name (the *other* person in the session/room),
 * best-effort. Used to label the chat header.
 */
export async function partnerNameInSession(
  scope: string,
  selfUserId: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.scope, scope))
    .orderBy(asc(messages.createdAt))
    .limit(50);

  for (const row of rows) {
    if (row.senderUserId !== selfUserId) return row.senderName;
  }
  return null;
}