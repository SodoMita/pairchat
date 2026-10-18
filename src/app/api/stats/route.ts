import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

type Stats = {
  waiting: number;
  activeChats: number;
  totalMessages: number;
  totalRooms: number;
};

const TTL_MS = 5_000;
let cached: { at: number; value: Stats } | null = null;
let inflight: Promise<Stats> | null = null;

async function compute(): Promise<Stats> {
  // One round-trip instead of four.
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM matchmaking WHERE paired_at IS NULL)::int AS waiting,
      (SELECT count(DISTINCT session_id) FROM matchmaking
         WHERE paired_at IS NOT NULL AND session_id IS NOT NULL)::int AS active,
      (SELECT count(*) FROM messages WHERE system_flag = false)::int AS messages,
      (SELECT count(*) FROM rooms)::int AS rooms
  `);
  const row = (result.rows?.[0] ?? {}) as Record<string, number>;
  return {
    waiting: row.waiting ?? 0,
    activeChats: row.active ?? 0,
    totalMessages: row.messages ?? 0,
    totalRooms: row.rooms ?? 0,
  };
}

/**
 * GET — public, aggregate counters for the landing page.
 *
 * Cached in-process for 5s (concurrent callers share one in-flight query)
 * and marked cacheable for 5s at the HTTP layer, so a burst of visitors
 * costs about one database round-trip per window. Returns 503 when the
 * database is unreachable, which the landing page shows as "unavailable" —
 * this is the only request it needs for both status and counters.
 */
export async function GET() {
  const now = Date.now();
  try {
    if (!cached || now - cached.at > TTL_MS) {
      inflight ??= compute().finally(() => {
        inflight = null;
      });
      cached = { at: now, value: await inflight };
    }
    return Response.json(cached.value, {
      headers: {
        "Cache-Control": "public, max-age=5, stale-while-revalidate=20",
      },
    });
  } catch {
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
