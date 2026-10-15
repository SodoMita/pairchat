import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matchmaking } from "@/db/schema";
import { getOrCreateUser } from "@/lib/session";
import {
  findOrJoinQueue,
  getActiveStrangerSession,
  leaveStrangerSession,
} from "@/lib/chat";

export const dynamic = "force-dynamic";

/**
 * GET — Poll for whether the current user has been paired yet.
 * Returns `{ state: "queued" }` while waiting or `{ state: "paired", sessionId, partnerId }` after pairing.
 */
export async function GET(_req: NextRequest) {
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
 * POST — Try to find a partner. If no one is waiting, enqueue and return queued.
 */
export async function POST(req: NextRequest) {
  const user = await getOrCreateUser();

  // If the user is already paired (page reload), just report.
  const existing = await getActiveStrangerSession(user.id);
  if (existing) {
    return Response.json({
      state: "paired",
      sessionId: existing.sessionId,
      partnerId: existing.partnerId,
      partnerIdentityPubKey: existing.partnerIdentityPubKey,
    });
  }

  // Accept the client's X25519 identity public key (base64url) and
  // store it on the matchmaking row so the partner can fetch it for
  // ECDH. The private key never leaves the browser.
  let identityPubKey: string | null = null;
  try {
    const body = await req.json();
    if (
      body &&
      typeof body === "object" &&
      typeof (body as { identityPubKey?: unknown }).identityPubKey === "string"
    ) {
      identityPubKey = String(
        (body as { identityPubKey: string }).identityPubKey,
      ).slice(0, 64);
    }
  } catch {
    /* no body — fine */
  }

  // Don't blow away an existing unpaired row — `findOrJoinQueue`
  // reuses it and preserves the previously-published identity pub key.
  const paired = await findOrJoinQueue(user.id, identityPubKey);
  if (paired) {
    return Response.json({
      state: "paired",
      sessionId: paired.sessionId,
      partnerId: paired.partnerId,
      partnerIdentityPubKey: null, // populated via /api/stranger/partner-key
    });
  }

  return Response.json({ state: "queued" });
}

/**
 * PATCH — Publish the user's X25519 identity public key. The client
 * generates its keypair on mount and pushes the public key here. If
 * the user isn't in the queue yet we create a row for them; otherwise
 * we update their existing row(s).
 */
export async function PATCH(req: NextRequest) {
  const user = await getOrCreateUser();
  let body: { identityPubKey?: string };
  try {
    body = (await req.json()) as { identityPubKey?: string };
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  const pub = String(body.identityPubKey ?? "").slice(0, 64);
  if (!pub) return Response.json({ error: "Missing key" }, { status: 400 });

  // Try to update the user's existing rows first (newest first). If
  // none exist, insert a fresh queue row with the key.
  const existing = await db
    .select()
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
  return Response.json({ ok: true });
}

/**
 * DELETE — Leave the queue or the active session.
 */
export async function DELETE(_req: NextRequest) {
  const user = await getOrCreateUser();
  await leaveStrangerSession(user.id);
  return Response.json({ ok: true });
}