import { sql } from "drizzle-orm";
import { db } from "@/db";
export const dynamic = "force-dynamic";
type Stats = { waiting: number; activeChats: number; totalRooms: number; totalMessages: number };
let cached: { at: number; value: Stats } | null = null;
let inflight: Promise<Stats> | null = null;
async function compute(): Promise<Stats> {
  const result = await db.execute(sql`SELECT
    (SELECT count(*) FROM matchmaking WHERE paired_at IS NULL AND created_at > now() - interval '10 minutes')::int AS waiting,
    (SELECT count(*) FROM (SELECT session_id FROM matchmaking WHERE session_id IS NOT NULL GROUP BY session_id HAVING count(*) = 2) p)::int AS active,
    (SELECT count(*) FROM rooms WHERE closed_at IS NULL AND joined_user_id IS NOT NULL)::int AS private_active,
    (SELECT count(*) FROM rooms)::int AS rooms`);
  const row = result.rows[0] as Record<string, number>;
  // No message counter: new message contents/records are never persisted.
  return { waiting: row.waiting, activeChats: row.active + row.private_active, totalRooms: row.rooms, totalMessages: 0 };
}
export async function GET() {
  try {
    if (!cached || Date.now() - cached.at > 5000) {
      inflight ??= compute().finally(() => { inflight = null; });
      cached = { at: Date.now(), value: await inflight };
    }
    return Response.json(cached.value, { headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=20" } });
  } catch { return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
