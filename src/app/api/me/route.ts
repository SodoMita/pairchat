import { NextRequest } from "next/server";
import { getOrCreateUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET — Return the current user's profile. Lazily creates one and sets
 * the session cookie if no cookie is present, so guests landing on a
 * room page can be identified without going through matchmaking first.
 */
export async function GET(_req: NextRequest) {
  const user = await getOrCreateUser();
  return Response.json({
    user: { id: user.id, displayName: user.displayName },
  });
}