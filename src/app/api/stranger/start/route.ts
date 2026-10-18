import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matchmaking } from "@/db/schema";
import { publish } from "@/lib/bus";
import { getOrCreateUser } from "@/lib/session";
import {
  findOrJoinQueue,
  getActiveStrangerSession,
  getUserName,
  leaveStrangerSession,
  userScope,
} from "@/lib/chat";

export const dynamic = "force-dynamic";

/** X25519 public keys are 32 raw bytes = 43 base64url characters. */
const PUBKEY_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * GET — one-shot status (kept for API clients). The web app does not poll
 * this: it opens `/api/stranger/events` and is pushed state instead.
 */
export async function GET() {
  const user = await getOrCreateUser();
  const session = await getActiveStrangerSession(user.id);
  if (session) {
    return Response.json({
      state: "paired",
      sessionId: session.sessionId,
      partnerId: session.partnerId,
      partnerIdentityPubKey: session.partnerIdentityPubKey,
    });
  }
  return Response.json({ state: "queued" });
}

/**
 * POST — enter the queue, or report the existing pairing. Also returns
 * `me`, so the client never needs a separate `/api/me` round-trip.
 * If this call completes a pairing, the waiting partner is pushed a
 * `paired` event instead of having to poll for it.
 */
export async function POST() {
  const user = await getOrCreateUser();
  const me = { id: user.id, displayName: user.displayName };

  const existing = await getActiveStrangerSession(user.id);
  if (existing) {
    return Response.json({
      state: "paired",
      sessionId: existing.sessionId,
      partnerId: existing.partnerId,
      partnerName: existing.partnerId
        ? await getUserName(existing.partnerId)
        : null,
      partnerLeft: !existing.partnerId,
      me,
    });
  }

  // `findOrJoinQueue` reuses an existing unpaired row, so a key published
  // before queueing is preserved.
  const paired = await findOrJoinQueue(user.id);
  if (!paired) return Response.json({ state: "queued", me });

  publish(
    userScope(paired.partnerId),
    JSON.stringify({
      type: "paired",
      sessionId: paired.sessionId,
      partnerId: user.id,
      partnerName: user.displayName,
    }),
  );
  return Response.json({
    state: "paired",
    sessionId: paired.sessionId,
    partnerId: paired.partnerId,
    partnerName: await getUserName(paired.partnerId),
    me,
  });
}

/**
 * PATCH — publish my X25519 identity public key and push it to my partner
 * (if paired). The server only ever sees public keys.
 */
export async function PATCH(req: NextRequest) {
  const user = await getOrCreateUser();
  let body: { identityPubKey?: unknown };
  try {
    body = (await req.json()) as { identityPubKey?: unknown };
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  const pub = typeof body.identityPubKey === "string" ? body.identityPubKey : "";
  if (!PUBKEY_RE.test(pub)) {
    return Response.json({ error: "Invalid public key" }, { status: 400 });
  }

  const existing = await db
    .select({ id: matchmaking.id })
    .from(matchmaking)
    .where(eq(matchmaking.userId, user.id))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(matchmaking)
      .set({ identityPubKey: pub })
      .where(eq(matchmaking.userId, user.id));
  } else {
    await db.insert(matchmaking).values({ userId: user.id, identityPubKey: pub });
  }

  const session = await getActiveStrangerSession(user.id);
  if (session?.partnerId) {
    publish(
      userScope(session.partnerId),
      JSON.stringify({ type: "partner_key", key: pub }),
    );
  }
  return Response.json({ ok: true });
}

/** DELETE — leave the queue / active chat and tell the partner. */
export async function DELETE() {
  const user = await getOrCreateUser();
  const session = await getActiveStrangerSession(user.id);
  if (session?.partnerId) {
    publish(
      userScope(session.partnerId),
      JSON.stringify({ type: "partner_left" }),
    );
  }
  await leaveStrangerSession(user.id);
  return Response.json({ ok: true });
}
