import { nanoid } from "nanoid";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { rooms } from "@/db/schema";
import { getOrCreateUser } from "@/lib/session";
import { hashPassphrase } from "@/lib/passphrase";
import { api, HttpError, limit, readJson } from "@/lib/request-security";
export const dynamic = "force-dynamic";
export const POST = api(async req => {
  const body = await readJson(req, 2048);
  if (typeof body.joinTokenHash !== "string" || !/^[a-f0-9]{64}$/.test(body.joinTokenHash)) throw new HttpError(400, "Invite capability hash required");
  if (body.passphrase !== undefined && (typeof body.passphrase !== "string" || body.passphrase.length > 128)) throw new HttpError(400, "Invalid passphrase");
  const user = await getOrCreateUser(req);
  limit(`room-create:${user.id}`, 5, 1 / 30);
  const passphraseHash = body.passphrase ? await hashPassphrase(body.passphrase as string) : null;
  const room = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`create-room:${user.id}`}))`);
    const open = await tx.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.hostUserId, user.id), isNull(rooms.closedAt))).limit(8);
    if (open.length >= 8) throw new HttpError(429, "Close an existing room before opening another", 60);
    const [created] = await tx.insert(rooms).values({ inviteCode: nanoid(10), hostUserId: user.id, passphraseHash, joinTokenHash: body.joinTokenHash as string }).returning();
    return created;
  });
  return Response.json({ room: { id: room.id, inviteCode: room.inviteCode, hasPassphrase: !!passphraseHash } }, { status: 201 });
});
