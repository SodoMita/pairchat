import { db } from "@/db";
import { chatParticipants, chatRooms } from "@/db/schema";
import { publishReadReceipt } from "@/lib/chat-events";
import {
  isValidClientId,
  isValidParticipantPublicId,
  isValidRoomId,
} from "@/lib/chat";
import { allowRequest } from "@/lib/rate-limit";
import {
  bearerCredential,
  isTrustedJsonMutation,
  readLimitedJson,
  requestClientAddress,
} from "@/lib/request-security";
import { hashAccessCredential } from "@/lib/server-credentials";
import { readAckSigningBytes } from "@/lib/e2ee";
import { verifyParticipantSignature } from "@/lib/server-signatures";
import { and, eq, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  if (!isTrustedJsonMutation(request)) {
    return NextResponse.json({ error: "Untrusted request." }, { status: 403 });
  }
  if (!allowRequest(`read:${requestClientAddress(request)}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many read receipts." }, { status: 429 });
  }

  const { roomId } = await context.params;
  const accessToken = bearerCredential(request);
  const accessHash = accessToken ? hashAccessCredential(accessToken) : null;
  const body = await readLimitedJson(request);
  const messageId = body?.messageId;
  const recipientPublicId = body?.recipientPublicId;
  const readAt = body?.readAt;
  const signature = body?.signature;

  if (
    !isValidRoomId(roomId) ||
    !isValidClientId(accessToken) ||
    typeof messageId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(messageId) ||
    !isValidParticipantPublicId(recipientPublicId) ||
    typeof readAt !== "string" ||
    !Number.isFinite(Date.parse(readAt)) ||
    Math.abs(Date.now() - Date.parse(readAt)) > 2 * 60_000 ||
    typeof signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/u.test(signature)
  ) {
    return NextResponse.json({ error: "Invalid read receipt." }, { status: 400 });
  }

  const [participant] = await db
    .select({ publicId: chatParticipants.publicId, signingKey: chatParticipants.signingKey })
    .from(chatParticipants)
    .innerJoin(chatRooms, eq(chatParticipants.roomId, chatRooms.id))
    .where(
      and(
        eq(chatParticipants.roomId, roomId),
        eq(chatParticipants.clientId, accessHash!),
        isNull(chatParticipants.leftAt),
        eq(chatRooms.status, "active"),
      ),
    )
    .limit(1);

  if (!participant || participant.publicId !== recipientPublicId) {
    return NextResponse.json({ error: "Not an active recipient." }, { status: 403 });
  }

  const ackBytes = readAckSigningBytes(roomId, messageId, recipientPublicId, readAt);
  if (!await verifyParticipantSignature(participant.signingKey, ackBytes, signature)) {
    return NextResponse.json({ error: "Invalid read signature." }, { status: 400 });
  }

  const published = publishReadReceipt(
    roomId,
    accessHash!,
    messageId,
    recipientPublicId,
    readAt,
    signature,
  );
  if (!published) {
    return NextResponse.json({ error: "Encrypted peer is not connected." }, { status: 409 });
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
