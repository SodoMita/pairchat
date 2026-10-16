import { sql } from "drizzle-orm";
import { db } from "@/db";
import { matchmaking, rooms, messages } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * GET — Public stats for the landing page. Returns:
 *   - waiting: number of people currently in the stranger queue
 *   - activeChats: number of paired stranger sessions (approximate,
 *     via unique sessionIds)
 *   - totalMessages: total messages ever sent (approximate count)
 *   - totalRooms: total rooms ever created
 *   - onlineUsers: total unique users who have been active recently
 *
 * All values are approximate, cached for 5s via revalidation.
 */
export async function GET() {
  const [waiting, active, totalMsgs, totalRooms] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(matchmaking)
      .where(sql`paired_at IS NULL`)
      .then((r) => r[0]?.count ?? 0),
    db
      .select({ count: sql<number>`count(DISTINCT session_id)::int` })
      .from(matchmaking)
      .where(sql`paired_at IS NOT NULL AND session_id IS NOT NULL`)
      .then((r) => r[0]?.count ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(sql`system_flag = false`)
      .then((r) => r[0]?.count ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(rooms)
      .then((r) => r[0]?.count ?? 0),
  ]);

  return Response.json({
    waiting,
    activeChats: active,
    totalMessages: totalMsgs,
    totalRooms,
  });
}