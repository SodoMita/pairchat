import { api, HttpError } from "@/lib/request-security";
import { requireUser } from "@/lib/session";
import { getActiveStrangerSession } from "@/lib/chat";
export const dynamic = "force-dynamic";
export const GET = api(async () => {
  const user = await requireUser();
  const session = await getActiveStrangerSession(user.id);
  if (!session?.partnerId) throw new HttpError(404, "No active partner");
  return Response.json({ ready: !!session.partnerIdentityPubKey, sessionId: session.sessionId, identityPubKey: session.partnerIdentityPubKey, partnerUserId: session.partnerId });
});
