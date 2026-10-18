import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rooms } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { closeRoom } from "@/lib/chat";
import { api, HttpError, readJson } from "@/lib/request-security";
import { UUID_RE } from "@/lib/protocol";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const GET = api<Context>(async (_req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) throw new HttpError(404, "Room not found");
  const [room] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
  if (!room) throw new HttpError(404, "Room not found");
  if (room.hostUserId !== user.id && room.joinedUserId !== user.id) throw new HttpError(403, "Not a participant");
  return Response.json({ room: { id: room.id, inviteCode: room.inviteCode, closed: !!room.closedAt, hasPassphrase: !!room.passphraseHash } });
});
export const DELETE = api<Context>(async (req, ctx) => {
  const user = await requireUser();
  await readJson(req, 1024, true);
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) throw new HttpError(404, "Room not found");
  await closeRoom(id, user.id);
  return Response.json({ ok: true });
});
