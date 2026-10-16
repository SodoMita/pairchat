import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { rooms } from "@/db/schema";
import { getOrCreateUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST — Create a new private room. Returns the room id and invite code.
 *
 * Optional body: `{ passphrase: "string" }` — if provided, joiners
 * must supply the same passphrase to enter the room. The passphrase
 * is hashed with SHA-256 before storage; the plaintext is never stored.
 */
export async function POST(req: NextRequest) {
  const user = await getOrCreateUser();

  // Close any prior open rooms owned by this user so we don't accumulate dead ones.
  await db
    .update(rooms)
    .set({ closedAt: sql`now()` })
    .where(
      and(eq(rooms.hostUserId, user.id), isNull(rooms.closedAt)),
    );

  // Parse optional passphrase.
  let passphraseHash: string | null = null;
  try {
    const body = (await req.json()) as { passphrase?: unknown };
    if (typeof body.passphrase === "string" && body.passphrase.trim()) {
      passphraseHash = createHash("sha256")
        .update(body.passphrase.trim())
        .digest("hex");
    }
  } catch {
    /* no body — fine */
  }

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
    .values({ inviteCode, hostUserId: user.id, passphraseHash })
    .returning();

  if (!created) return Response.json({ error: "Create failed" }, { status: 500 });

  return Response.json({
    room: {
      id: created.id,
      inviteCode: created.inviteCode,
      hasPassphrase: !!passphraseHash,
    },
  });
}