import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { rooms, users, type Room } from "@/db/schema";
import { publish } from "@/lib/bus";
import { roomScope } from "@/lib/chat";
import { HttpError, limit } from "@/lib/request-security";
import { hashPassphrase, verifyPassphrase } from "@/lib/passphrase";
export { UUID_RE } from "@/lib/protocol";
import { UUID_RE } from "@/lib/protocol";
export const INVITE_CODE_RE = /^[A-Za-z0-9_-]{10}$/;
export const isRoomRef = (ref: string) => UUID_RE.test(ref) || INVITE_CODE_RE.test(ref);
export const hashCapability = (proof: string) => createHash("sha256").update(proof).digest("hex");
export type EnterResult = { kind: "ok"; role: "host" | "guest"; room: Room; partner: { id: string; displayName: string } | null };

export async function enterRoom(params: { ref: string; userId: string; userName: string; passphrase: string | null; proof?: string }): Promise<EnterResult> {
  const { ref, userId, userName, passphrase, proof } = params;
  let newlySeated = false;
  const result = await db.transaction(async (tx): Promise<EnterResult> => {
    const [found] = await tx.select().from(rooms).where(UUID_RE.test(ref) ? eq(rooms.id, ref) : eq(rooms.inviteCode, ref)).limit(1);
    if (!found) throw new HttpError(404, "Room not found");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`room:${found.id}`}))`);
    const [room] = await tx.select().from(rooms).where(eq(rooms.id, found.id)).limit(1);
    if (!room || room.closedAt) throw new HttpError(410, "Room closed");
    const nameOf = async (id: string) => (await tx.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, id)).limit(1))[0] ?? null;
    if (room.hostUserId === userId) return { kind: "ok", role: "host", room, partner: room.joinedUserId ? await nameOf(room.joinedUserId) : null };
    // Re-entering with the same authenticated participant is idempotent.
    if (room.joinedUserId === userId) return { kind: "ok", role: "guest", room, partner: await nameOf(room.hostUserId) };
    if (room.joinTokenHash) {
      if (!proof || !/^[A-Za-z0-9_-]{43}$/.test(proof) || !timingSafeEqual(Buffer.from(room.joinTokenHash, "hex"), Buffer.from(hashCapability(proof), "hex"))) {
        throw new HttpError(403, "The complete invite link is required");
      }
    }
    if (room.joinedUserId) throw new HttpError(409, "Room is full");
    if (room.passphraseHash) {
      if (!passphrase) throw new HttpError(401, "Incorrect passphrase");
      const check = await verifyPassphrase(room.passphraseHash, passphrase);
      if (!check.valid) throw new HttpError(401, "Incorrect passphrase");
      if (check.legacy) await tx.update(rooms).set({ passphraseHash: await hashPassphrase(passphrase) }).where(eq(rooms.id, room.id));
    }
    await tx.update(rooms).set({ joinedUserId: userId }).where(eq(rooms.id, room.id));
    newlySeated = true;
    return { kind: "ok", role: "guest", room: { ...room, joinedUserId: userId }, partner: await nameOf(room.hostUserId) };
  });
  if (newlySeated) publish(roomScope(result.room.id), JSON.stringify({ type: "guest_joined", userId, displayName: userName }));
  return result;
}
