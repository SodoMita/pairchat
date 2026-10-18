import { api, limit } from "@/lib/request-security";
import { requireUser } from "@/lib/session";
import { eventStream } from "@/lib/event-stream";
import { roomScope } from "@/lib/chat";
import { relaySend, withAccess } from "@/lib/relay";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const POST = api<Context>(async (req, ctx) => {
  const user = await requireUser();
  return relaySend(req, user, roomScope((await ctx.params).id));
});
export const GET = api<Context>(async (req, ctx) => {
  const user = await requireUser();
  limit(`streams:${user.id}`, 20, 0.5);
  const scope = roomScope((await ctx.params).id);
  await withAccess(scope, user.id, () => {}, true);
  return eventStream(req, user.id, scope, { expiresAt: user.sessionExpiresAt.getTime(), initial: () => withAccess(scope, user.id, (peer, closed) => ({ type: closed ? "room_closed" : "state", active: !closed, partnerPresent: !!peer }), true) });
});
