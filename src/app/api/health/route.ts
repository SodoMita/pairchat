import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Readiness check — tests that the database is reachable.
 * Returns 200 only when the app is ready to serve real requests.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, checks: { database: "ok" } });
  } catch (err) {
    return Response.json(
      { ok: false, checks: { database: "error" } },
      { status: 503 },
    );
  }
}
