import { NextRequest } from "next/server";
import { getOrCreateUser } from "@/lib/session";
import { consume } from "@/lib/rateLimit";
import { enterRoom, isRoomRef } from "@/lib/rooms";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST — "I opened this room link." One request returns everything the
 * static room page needs: who I am, which room this is (resolving invite
 * codes to the real id), my role, and the partner. Guests atomically claim
 * the single guest seat; hosts simply get their room back.
 *
 *   200 → { me, room: { id, inviteCode, role, hasPassphrase }, partner }
 *   401 → passphrase required / incorrect
 *   404 → unknown or malformed reference
 *   409 → room is full
 *   410 → room was closed
 */
export async function POST(req: NextRequest, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!isRoomRef(id)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const user = await getOrCreateUser();
  const limit = consume(`room-enter:${user.id}`, 20, 1);
  if (!limit.ok) {
    return Response.json(
      { error: "Rate limited" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      },
    );
  }

  let passphrase: string | null = null;
  try {
    const body = (await req.json()) as { passphrase?: unknown };
    if (typeof body.passphrase === "string" && body.passphrase.trim()) {
      passphrase = body.passphrase.trim().slice(0, 128);
    }
  } catch {
    /* no body */
  }

  const result = await enterRoom({
    ref: id,
    userId: user.id,
    userName: user.displayName,
    passphrase,
  });

  switch (result.kind) {
    case "not_found":
      return Response.json({ error: "Not found" }, { status: 404 });
    case "closed":
      return Response.json({ error: "Room closed" }, { status: 410 });
    case "wrong_passphrase":
      return Response.json(
        { error: "Incorrect passphrase", needsPassphrase: true },
        { status: 401 },
      );
    case "full":
      return Response.json({ error: "Room is full" }, { status: 409 });
    case "ok":
      return Response.json({
        me: { id: user.id, displayName: user.displayName },
        room: {
          id: result.room.id,
          inviteCode: result.room.inviteCode,
          role: result.role,
          hasPassphrase: !!result.room.passphraseHash,
        },
        partner: result.partner
          ? { displayName: result.partner.displayName }
          : null,
      });
  }
}
