import { db } from "@/db";
import { ensureChatSchema } from "@/db/ensure";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureChatSchema();
    await db.execute(sql`select id from chat_rooms limit 0`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
