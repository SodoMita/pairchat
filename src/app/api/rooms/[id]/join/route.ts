import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rooms } from "@/db/schema";
import { getOrCreateUser } from "@/lib/session";
import { eq, and, isNull } from "drizzle-orm";
import { publish } from "@/lib/bus";
import { roomScope } from "@/lib/chat";
import { consume } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST — Claim the guest seat in a private room. Atomic via
 * `pg_advisory_xact_lock(hashtext(room_id))`: while one join transaction
 * holds the lock, no other can read/write the seat column. Returns the
 * other participant's display name on success.
 *
 *   200 → joined successfully, returns { partner: { id, displayName } | null }
 *   404 → room not found / malformed id / already closed
 *   403 → you are the host joining your own room
 *   409 → room is full (already has a guest)
 */
export async function POST(_req: NextRequest, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const user = await getOrCreateUser();

  const limit = consume(`room-join:${user.id}`, 10, 1);
  if (!limit.ok) {
    return Response.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  const result = await db.transaction(async (tx) => {
    // Serialize on the room id. hashtext produces a stable int8 key.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`room:${id}`}))`,
    );

    const rows = await tx
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, id), isNull(rooms.closedAt)))
      .limit(1);
    const room = rows[0];
    if (!room) return { kind: "not_found" as const };

    if (room.hostUserId === user.id) {
      return { kind: "self" as const };
    }

    if (room.joinedUserId && room.joinedUserId !== user.id) {
      return { kind: "full" as const };
    }

    // Claim the seat (idempotent for re-joins by the same guest).
    if (!room.joinedUserId) {
      await tx
        .update(rooms)
        .set({ joinedUserId: user.id })
        .where(eq(rooms.id, id));
    }

    // Look up the host's display name for the joiner to render.
    const hostRows = await tx.execute(
      sql`SELECT id, display_name FROM users WHERE id = ${room.hostUserId} LIMIT 1`,
    );
    const host = (hostRows.rows?.[0] as { id: string; display_name: string } | undefined) ?? null;

    return {
      kind: "ok" as const,
      host: host ? { id: host.id, displayName: host.display_name } : null,
    };
  });

  if (result.kind === "not_found") {
    return Response.json({ error: "Room closed" }, { status: 404 });
  }
  if (result.kind === "self") {
    return Response.json({ error: "You are the host" }, { status: 403 });
  }
  if (result.kind === "full") {
    return Response.json({ error: "Room is full" }, { status: 409 });
  }

  // Notify any subscribers that the room's membership changed.
  publish(
    roomScope(id),
    JSON.stringify({ type: "guest_joined", userId: user.id }),
  );

  return Response.json({ ok: true, partner: result.host });
}