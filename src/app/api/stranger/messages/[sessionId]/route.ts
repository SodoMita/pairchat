import { api, limit } from "@/lib/request-security";
import { requireUser } from "@/lib/session";
import { eventStream } from "@/lib/event-stream";
import { strangerScope } from "@/lib/chat";
import { relaySend, withAccess } from "@/lib/relay";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ sessionId: string }> };
export const POST = api<Context>(async (req, ctx) => {
  const user = await requireUser();
  return relaySend(req, user, strangerScope((await ctx.params).sessionId));
});
export const GET = api<Context>(async (req, ctx) => {
  const user = await requireUser();
  limit(`streams:${user.id}`, 20, 0.5);
  const scope = strangerScope((await ctx.params).sessionId);
  await withAccess(scope, user.id, () => {}, true);
  return eventStream(req, user.id, scope, { expiresAt: user.sessionExpiresAt.getTime(), initial: () => withAccess(scope, user.id, (_peer, closed) => ({ type: closed ? "session_ended" : "state", active: !closed }), true) });
});
