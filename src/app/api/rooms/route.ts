import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { rooms } from "@/db/schema";
import { getOrCreateUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST — Create a new private room. Returns the room id and invite code.
 */
export async function POST(_req: NextRequest) {
  const user = await getOrCreateUser();

  // Close any prior open rooms owned by this user so we don't accumulate dead ones.
  await db
    .update(rooms)
    .set({ closedAt: sql`now()` })
    .where(
      and(eq(rooms.hostUserId, user.id), isNull(rooms.closedAt)),
    );

  let inviteCode = "";
  for (let i = 0; i < 5; i += 1) {
    const candidate = nanoid(10);
    const clash = await db
      .select()
      .from(rooms)
      .where(eq(rooms.inviteCode, candidate))
      .limit(1);
    if (clash.length === 0) {
      inviteCode = candidate;
      break;
    }
  }
  if (!inviteCode) {
    return Response.json({ error: "Could not allocate code" }, { status: 500 });
  }

  const [created] = await db
    .insert(rooms)
    .values({ inviteCode, hostUserId: user.id })
    .returning();

  if (!created) return Response.json({ error: "Create failed" }, { status: 500 });

  return Response.json({
    room: { id: created.id, inviteCode: created.inviteCode },
  });
}