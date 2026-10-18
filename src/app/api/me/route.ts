import { api } from "@/lib/request-security";
import { getOrCreateUser } from "@/lib/session";
export const dynamic = "force-dynamic";
export const GET = api(async (req) => {
  const user = await getOrCreateUser(req);
  return Response.json({ user: { id: user.id, displayName: user.displayName } });
});
