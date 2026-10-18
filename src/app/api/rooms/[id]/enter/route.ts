import { api, HttpError, limit, readJson } from "@/lib/request-security";
import { getOrCreateUser } from "@/lib/session";
import { enterRoom, isRoomRef } from "@/lib/rooms";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const POST = api<Context>(async (req, ctx) => {
  const { id } = await ctx.params;
  if (!isRoomRef(id)) throw new HttpError(404, "Room not found");
  const body = await readJson(req, 2048, true);
  if (body.passphrase !== undefined && (typeof body.passphrase !== "string" || body.passphrase.length > 128)) throw new HttpError(400, "Invalid passphrase");
  if (body.proof !== undefined && (typeof body.proof !== "string" || body.proof.length !== 43)) throw new HttpError(400, "Invalid invite proof");
  const user = await getOrCreateUser(req);
  limit(`enter:${user.id}`, 20, 0.5);
  const result = await enterRoom({ ref: id, userId: user.id, userName: user.displayName, passphrase: typeof body.passphrase === "string" ? body.passphrase : null, proof: body.proof as string | undefined });
  return Response.json({ me: { id: user.id, displayName: user.displayName }, room: { id: result.room.id, inviteCode: result.room.inviteCode, role: result.role, hasPassphrase: !!result.room.passphraseHash }, partner: result.partner });
});
