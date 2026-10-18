import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { rooms, users, type Room } from "@/db/schema";
import { publish } from "@/lib/bus";
import { roomScope } from "@/lib/chat";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Invite codes are nanoid(10) over [A-Za-z0-9_-]. */
export const INVITE_CODE_RE = /^[A-Za-z0-9_-]{10}$/;

/** A room reference is either its UUID or its short invite code. */
export function isRoomRef(value: string): boolean {
  return UUID_RE.test(value) || INVITE_CODE_RE.test(value);
}

export function hashPassphrase(passphrase: string): string {
  return createHash("sha256").update(passphrase).digest("hex");
}

function passphraseMatches(stored: string, provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(hashPassphrase(provided), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type EnterResult =
  | { kind: "not_found" }
  | { kind: "closed" }
  | { kind: "wrong_passphrase" }
  | { kind: "full" }
  | {
      kind: "ok";
      role: "host" | "guest";
      room: Room;
      partner: { id: string; displayName: string } | null;
    };

/**
 * Single entry point for "I opened this room link". Resolves a UUID or
 * invite code, serialises on a per-room advisory lock, and — for a guest —
 * atomically claims the one guest seat. Hosts get their own room back
 * instead of an error, so the client needs exactly one request to learn
 * who it is, which room it is in, and who the partner is.
 */
export async function enterRoom(params: {
  ref: string;
  userId: string;
  userName: string;
  passphrase: string | null;
}): Promise<EnterResult> {
  const { ref, userId, userName, passphrase } = params;

  let newlySeated = false;
  const result = await db.transaction(async (tx): Promise<EnterResult> => {
    const lookup = UUID_RE.test(ref)
      ? eq(rooms.id, ref)
      : eq(rooms.inviteCode, ref);
    const [found] = await tx.select().from(rooms).where(lookup).limit(1);
    if (!found) return { kind: "not_found" };

    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`room:${found.id}`}))`,
    );
    // Re-read under the lock so seat/closed state can't be stale.
    const [room] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, found.id))
      .limit(1);
    if (!room) return { kind: "not_found" };
    if (room.closedAt) return { kind: "closed" };

    const nameOf = async (id: string) => {
      const [u] = await tx
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return u ?? null;
    };

    if (room.hostUserId === userId) {
      const guest = room.joinedUserId ? await nameOf(room.joinedUserId) : null;
      return { kind: "ok", role: "host", room, partner: guest };
    }

    if (room.passphraseHash && !passphraseMatches(room.passphraseHash, passphrase)) {
      return { kind: "wrong_passphrase" };
    }
    if (room.joinedUserId && room.joinedUserId !== userId) {
      return { kind: "full" };
    }
    if (!room.joinedUserId) {
      await tx.update(rooms).set({ joinedUserId: userId }).where(eq(rooms.id, room.id));
      newlySeated = true;
    }
    const host = await nameOf(room.hostUserId);
    return { kind: "ok", role: "guest", room, partner: host };
  });

  if (result.kind === "ok" && newlySeated) {
    publish(
      roomScope(result.room.id),
      JSON.stringify({ type: "guest_joined", userId, displayName: userName }),
    );
  }
  return result;
}
