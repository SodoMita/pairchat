import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rooms } from "@/db/schema";
import { getOrCreateUser } from "@/lib/session";
import { closeRoom, roomScope } from "@/lib/chat";
import { publish } from "@/lib/bus";

export const dynamic = "force-dynamic";
type RouteParams = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badId() {
  return Response.json({ error: "Not found" }, { status: 404 });
}

/**
 * GET — Return room metadata (id, inviteCode, hostUserId, closed).
 */
export async function GET(_req: NextRequest, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return badId();
  const user = await getOrCreateUser();
  const rows = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
  const room = rows[0];
  if (!room) return Response.json({ error: "Not found" }, { status: 404 });
  if (room.hostUserId !== user.id && room.joinedUserId !== user.id) {
    return Response.json({ error: "Not a participant" }, { status: 403 });
  }
  return Response.json({
    room: {
      id: room.id,
      inviteCode: room.inviteCode,
      closed: !!room.closedAt,
    },
  });
}

/**
 * DELETE — Close the room. Anyone in the room may close it (the host can
 * always close; the guest can leave which also closes since it's 1:1).
 */
export async function DELETE(_req: NextRequest, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return badId();
  const user = await getOrCreateUser();
  const rows = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
  const room = rows[0];
  if (!room) return Response.json({ error: "Not found" }, { status: 404 });
  if (room.hostUserId !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await closeRoom(id);
  publish(roomScope(id), JSON.stringify({ type: "room_closed" }));
  return Response.json({ ok: true });
}