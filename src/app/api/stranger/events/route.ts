import { api, limit } from "@/lib/request-security";
import { requireUser } from "@/lib/session";
import { eventStream } from "@/lib/event-stream";
import { getActiveStrangerSession, getUserName, userScope } from "@/lib/chat";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = api(async req => {
  const user = await requireUser();
  limit(`streams:${user.id}`, 20, 0.5);
  return eventStream(req, user.id, userScope(user.id), { named: true, expiresAt: user.sessionExpiresAt.getTime(), initial: async () => {
    const s = await getActiveStrangerSession(user.id);
    return s ? { type: "state", state: "paired", sessionId: s.sessionId, partnerId: s.partnerId, partnerName: s.partnerId ? await getUserName(s.partnerId) : null, partnerLeft: !s.partnerId, partnerKey: s.partnerIdentityPubKey } : { type: "state", state: "queued" };
  } });
});
