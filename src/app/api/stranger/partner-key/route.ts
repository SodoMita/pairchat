import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { matchmaking } from "@/db/schema";
import { getOrCreateUser } from "@/lib/session";
import { getActiveStrangerSession } from "@/lib/chat";

export const dynamic = "force-dynamic";

/**
 * GET — Return the partner's static X25519 public key for the user's
 * active stranger session. The client polls this until the partner
 * publishes their key (see PATCH /api/stranger/start). The server
 * never sees the corresponding private keys.
 */
export async function GET(_req: NextRequest) {
  const user = await getOrCreateUser();
  const session = await getActiveStrangerSession(user.id);
  if (!session?.sessionId || !session.partnerId) {
    return Response.json({ error: "Not in session" }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(matchmaking)
    .where(
      and(
        eq(matchmaking.sessionId, session.sessionId),
        eq(matchmaking.userId, session.partnerId),
      ),
    )
    .limit(1);

  if (rows.length === 0 || !rows[0].identityPubKey) {
    return Response.json({ ready: false });
  }

  return Response.json({
    ready: true,
    identityPubKey: rows[0].identityPubKey,
    partnerUserId: session.partnerId,
  });
}