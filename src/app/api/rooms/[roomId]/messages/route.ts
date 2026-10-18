import { db } from "@/db";
import { chatParticipants, chatRooms } from "@/db/schema";
import {
  isValidClientId,
  isValidParticipantPublicId,
  isValidRoomId,
} from "@/lib/chat";
import {
  publishChatMessage,
  type EncryptedMessageEnvelope,
} from "@/lib/chat-events";
import { allowRequest } from "@/lib/rate-limit";
import { bearerCredential, isTrustedJsonMutation, requestClientAddress, readLimitedJson } from "@/lib/request-security";
import { claimMessageId } from "@/lib/replay-cache";
import { verifyServerEnvelopeSignature } from "@/lib/server-signatures";
import { hashAccessCredential } from "@/lib/server-credentials";
import { and, eq, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function isEncryptedEnvelope(
  value: unknown,
): value is EncryptedMessageEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<EncryptedMessageEnvelope>;
  const createdAt = Date.parse(envelope.createdAt ?? "");
  return (
    envelope.version === 1 &&
    typeof envelope.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(envelope.id) &&
    isValidParticipantPublicId(envelope.senderPublicId) &&
    typeof envelope.iv === "string" &&
    /^[A-Za-z0-9_-]{16}$/u.test(envelope.iv) &&
    typeof envelope.ciphertext === "string" &&
    envelope.ciphertext.length >= 23 &&
    envelope.ciphertext.length <= 2200 &&
    /^[A-Za-z0-9_-]+$/u.test(envelope.ciphertext) &&
    typeof envelope.signature === "string" &&
    /^[A-Za-z0-9_-]{86}$/u.test(envelope.signature) &&
    Number.isFinite(createdAt) &&
    Math.abs(Date.now() - createdAt) < 5 * 60_000
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  if (!isTrustedJsonMutation(request)) {
    return NextResponse.json({ error: "Untrusted request." }, { status: 403 });
  }
  const { roomId } = await context.params;
  const payload = await readLimitedJson(request);
  const clientId = bearerCredential(request);

  if (!isValidRoomId(roomId) || !isValidClientId(clientId)) {
    return NextResponse.json({ error: "Invalid message request." }, { status: 400 });
  }
  const accessHash = hashAccessCredential(clientId);
  if (!isEncryptedEnvelope(payload?.envelope)) {
    return NextResponse.json({ error: "Invalid encrypted envelope." }, { status: 400 });
  }
  if (!allowRequest(`message:${requestClientAddress(request)}:${roomId}:${accessHash}`, 20, 10_000)) {
    return NextResponse.json({ error: "Too many messages." }, { status: 429 });
  }

  const [permission] = await db
    .select({
      roomStatus: chatRooms.status,
      signingKey: chatParticipants.signingKey,
      publicId: chatParticipants.publicId,
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

  if (!permission) {
    return NextResponse.json(
      { error: "You are not an active participant." },
      { status: 403 },
    );
  }
  if (permission.roomStatus !== "active") {
    return NextResponse.json(
      { error: "This chat is not active." },
      { status: 409 },
    );
  }
  if (permission.publicId !== payload.envelope.senderPublicId) {
    return NextResponse.json(
      { error: "Sender identity does not match this participant." },
      { status: 403 },
    );
  }
  if (!permission.signingKey) {
    return NextResponse.json(
      { error: "Sender signing key is not registered." },
      { status: 409 },
    );
  }
  const signatureValid = await verifyServerEnvelopeSignature(
    permission.signingKey,
    roomId,
    payload.envelope,
  );
  if (!signatureValid) {
    return NextResponse.json(
      { error: "Invalid message signature." },
      { status: 400 },
    );
  }

  if (!claimMessageId(roomId, payload.envelope.id)) {
    return NextResponse.json({ error: "Duplicate encrypted message." }, { status: 409 });
  }
  const delivered = publishChatMessage(roomId, accessHash, payload.envelope);
  if (!delivered) {
    return NextResponse.json(
      { error: "Encrypted peer is not connected." },
      { status: 409 },
    );
  }
  return NextResponse.json({ envelope: payload.envelope }, { status: 202 });
}
