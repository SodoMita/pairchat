import { db } from "@/db";
import { chatParticipants, chatRooms } from "@/db/schema";
import { isValidClientId, isValidRoomId } from "@/lib/chat";
import { publishTypingState } from "@/lib/chat-events";
import { allowRequest } from "@/lib/rate-limit";
import { bearerCredential, isTrustedJsonMutation, readLimitedJson, requestClientAddress } from "@/lib/request-security";
import { hashAccessCredential } from "@/lib/server-credentials";
import { and, eq, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  if (!isTrustedJsonMutation(request)) {
    return NextResponse.json({ error: "Untrusted request." }, { status: 403 });
  }
  const { roomId } = await context.params;
  const clientId = bearerCredential(request);
  const body = await readLimitedJson(request, 1_000);
  const active = body?.active;

  if (!isValidRoomId(roomId) || !isValidClientId(clientId) || typeof active !== "boolean") {
    return NextResponse.json({ error: "Invalid typing signal." }, { status: 400 });
  }

  const accessHash = hashAccessCredential(clientId);
  if (!allowRequest(`typing:${requestClientAddress(request)}:${roomId}:${accessHash}`, 20, 10_000)) {
    return NextResponse.json({ error: "Too many typing signals." }, { status: 429 });
  }

  const [participant] = await db
    .select({
      publicId: chatParticipants.publicId,
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

  if (!participant || participant.roomStatus !== "active") {
    return NextResponse.json({ error: "This chat is not active." }, { status: 403 });
  }

  publishTypingState(roomId, accessHash, participant.publicId, active);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
