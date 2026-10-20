import { db } from "@/db";
import { chatParticipants, chatRooms } from "@/db/schema";
import { isValidClientId, isValidRoomId } from "@/lib/chat";
import { canvasSigningBytes, isCanvasEnvelope } from "@/lib/canvas";
import { isCanvasEnabled } from "@/lib/canvas-flag";
import { publishCanvasEvent } from "@/lib/chat-events";
import { allowRequest } from "@/lib/rate-limit";
import { claimMessageId } from "@/lib/replay-cache";
import {
  bearerCredential,
  isTrustedJsonMutation,
  readLimitedJson,
  requestClientAddress,
} from "@/lib/request-security";
import { hashAccessCredential } from "@/lib/server-credentials";
import { verifyParticipantSignature } from "@/lib/server-signatures";
import { and, eq, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  if (!isCanvasEnabled()) {
    return NextResponse.json({ error: "Canvas is disabled." }, { status: 404 });
  }
  if (!isTrustedJsonMutation(request)) {
    return NextResponse.json({ error: "Untrusted request." }, { status: 403 });
  }
  const { roomId } = await context.params;
  const payload = await readLimitedJson(request, 12_000);
  const clientId = bearerCredential(request);
  if (!isValidRoomId(roomId) || !isValidClientId(clientId)) {
    return NextResponse.json({ error: "Invalid canvas request." }, { status: 400 });
  }
  const accessHash = hashAccessCredential(clientId);
  if (!isCanvasEnvelope(payload?.envelope)) {
    return NextResponse.json({ error: "Invalid canvas envelope." }, { status: 400 });
  }
  if (!allowRequest(`canvas:${requestClientAddress(request)}:${roomId}:${accessHash}`, 60, 10_000)) {
    return NextResponse.json({ error: "Too many canvas events." }, { status: 429 });
  }

  const members = await db
    .select({
      clientId: chatParticipants.clientId,
      publicId: chatParticipants.publicId,
      signingKey: chatParticipants.signingKey,
      roomStatus: chatRooms.status,
    })
    .from(chatParticipants)
    .innerJoin(chatRooms, eq(chatParticipants.roomId, chatRooms.id))
    .where(
      and(
        eq(chatParticipants.roomId, roomId),
        isNull(chatParticipants.leftAt),
      ),
    );

  const permission = members.find((member) => member.clientId === accessHash);
  const peer = members.find((member) => member.clientId !== accessHash);

  if (!permission) {
    return NextResponse.json({ error: "You are not an active participant." }, { status: 403 });
  }
  if (permission.roomStatus !== "active" || !peer) {
    return NextResponse.json({ error: "This chat is not active." }, { status: 409 });
  }
  if (permission.publicId !== payload.envelope.senderPublicId) {
    return NextResponse.json({ error: "Sender does not match this participant." }, { status: 403 });
  }
  if (
    !await verifyParticipantSignature(
      permission.signingKey,
      canvasSigningBytes(roomId, payload.envelope),
      payload.envelope.signature,
    )
  ) {
    return NextResponse.json({ error: "Invalid canvas signature." }, { status: 400 });
  }
  if (!claimMessageId(roomId, payload.envelope.id)) {
    return NextResponse.json({ error: "Duplicate canvas envelope." }, { status: 409 });
  }

  publishCanvasEvent(roomId, accessHash, payload.envelope);
  return NextResponse.json({ ok: true }, { status: 202 });
}
