import { db } from "@/db";
import { chatParticipants, chatRooms } from "@/db/schema";
import { isValidClientId, isValidRoomId } from "@/lib/chat";
import { isCanvasEnvelope } from "@/lib/canvas";
import { isCanvasEnabled } from "@/lib/canvas-flag";
import { publishCanvasEvent } from "@/lib/chat-events";
import { allowRequest } from "@/lib/rate-limit";
import {
  bearerCredential,
  isTrustedJsonMutation,
  readLimitedJson,
  requestClientAddress,
} from "@/lib/request-security";
import { hashAccessCredential } from "@/lib/server-credentials";
import { canvasSigningBytes } from "@/lib/canvas";
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
  if (!allowRequest(`canvas:${requestClientAddress(request)}:${roomId}:${accessHash}`, 40, 10_000)) {
    return NextResponse.json({ error: "Too many canvas events." }, { status: 429 });
  }

  const [permission] = await db
    .select({
      publicId: chatParticipants.publicId,
      signingKey: chatParticipants.signingKey,
      roomStatus: chatRooms.status,
    })
    .from(chatParticipants)
    .innerJoin(chatRooms, eq(chatParticipants.roomId, chatRooms.id))
    .where(
      and(
        eq(chatParticipants.roomId, roomId),
        eq(chatParticipants.clientId, accessHash),
        isNull(chatParticipants.leftAt),
      ),
    )
    .limit(1);

  if (!permission || permission.roomStatus !== "active") {
    return NextResponse.json({ error: "This chat is not active." }, { status: 403 });
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

  const delivered = publishCanvasEvent(roomId, accessHash, payload.envelope);
  if (!delivered) {
    return NextResponse.json({ error: "Encrypted peer is not connected." }, { status: 409 });
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}
