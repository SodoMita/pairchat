import { NextRequest } from "next/server";
import { getOrCreateUser } from "@/lib/session";
import { consume } from "@/lib/rateLimit";
import { enterRoom, UUID_RE } from "@/lib/rooms";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST — Claim the guest seat in a private room. Kept for API clients;
 * the web app uses `/enter`, which shares this exact logic.
 *
 *   200 → joined, returns { ok, partner: { id, displayName } | null }
 *   401 → passphrase missing / wrong
 *   403 → you are the host joining your own room
 *   404 → not found / malformed id / closed
 *   409 → room is full
 */
export async function POST(req: NextRequest, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const user = await getOrCreateUser();

  const limit = consume(`room-join:${user.id}`, 10, 1);
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
    case "closed":
      return Response.json({ error: "Room closed" }, { status: 404 });
    case "wrong_passphrase":
      return Response.json({ error: "Incorrect passphrase" }, { status: 401 });
    case "full":
      return Response.json({ error: "Room is full" }, { status: 409 });
    case "ok":
      if (result.role === "host") {
        return Response.json({ error: "You are the host" }, { status: 403 });
      }
      return Response.json({ ok: true, partner: result.partner });
  }
}
