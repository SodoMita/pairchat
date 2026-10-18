import { api, readJson, limit, HttpError } from "@/lib/request-security";
import { getOrCreateUser, requireUser } from "@/lib/session";
import { findOrJoinQueue, getActiveStrangerSession, getUserName, leaveStrangerSession, publishIdentity, userScope } from "@/lib/chat";
import { publish } from "@/lib/bus";
import { SID_RE } from "@/lib/protocol";
import { usablePublicKey } from "@/lib/public-key-validation";
export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const user = await requireUser();
  const session = await getActiveStrangerSession(user.id);
  return Response.json(session ? { state: "paired", ...session } : { state: "queued" });
});
export const POST = api(async req => {
  await readJson(req, 1024, true);
  const user = await getOrCreateUser(req);
  limit(`match:${user.id}`, 12, 0.2);
  const paired = await findOrJoinQueue(user.id);
  const me = { id: user.id, displayName: user.displayName };
  if (!paired) return Response.json({ state: "queued", me });
  if (paired.newlyPaired && paired.partnerId) publish(userScope(paired.partnerId), JSON.stringify({ type: "paired", sessionId: paired.sessionId, partnerId: user.id, partnerName: user.displayName }));
  return Response.json({ state: "paired", ...paired, partnerName: paired.partnerId ? await getUserName(paired.partnerId) : null, partnerLeft: !paired.partnerId, me });
});
export const PATCH = api(async req => {
  const user = await requireUser();
  limit(`publish-key:${user.id}`, 12, 0.5);
  const body = await readJson(req, 1024);
  if (typeof body.sessionId !== "string" || !SID_RE.test(body.sessionId) || !usablePublicKey(body.identityPubKey)) throw new HttpError(400, "Valid session and public key required");
  await publishIdentity(user.id, body.sessionId, body.identityPubKey);
  return Response.json({ ok: true });
});
export const DELETE = api(async req => {
  const user = await requireUser();
  const body = await readJson(req, 1024, true);
  if (body.sessionId !== undefined && (typeof body.sessionId !== "string" || !SID_RE.test(body.sessionId))) throw new HttpError(400, "Invalid session");
  await leaveStrangerSession(user.id, body.sessionId as string | undefined);
  return Response.json({ ok: true });
});
