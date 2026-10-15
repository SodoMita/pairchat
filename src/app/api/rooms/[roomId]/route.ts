import { db } from "@/db";
import { chatParticipants, chatRooms } from "@/db/schema";
import { isValidClientId, isValidRoomId } from "@/lib/chat";
import { getRoomSnapshot } from "@/lib/chat-server";
import { bearerCredential, isTrustedJsonMutation, readLimitedJson } from "@/lib/request-security";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await context.params;
  const clientId = bearerCredential(request);

  if (!isValidRoomId(roomId) || !isValidClientId(clientId)) {
    return NextResponse.json({ error: "Invalid room request." }, { status: 400 });
  }

  const touchPresence = request.nextUrl.searchParams.get("touch") !== "false";
  const room = await getRoomSnapshot(roomId, clientId, touchPresence);
  if (!room) {
    return NextResponse.json({ error: "Chat room not found." }, { status: 404 });
  }

  return NextResponse.json({ room });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  if (!isTrustedJsonMutation(request)) {
    return NextResponse.json({ error: "Untrusted request." }, { status: 403 });
  }
  const { roomId } = await context.params;
  const body = await readLimitedJson(request);
  const clientId = body?.clientId;

  if (!isValidRoomId(roomId) || !isValidClientId(clientId)) {
    return NextResponse.json({ error: "Invalid room request." }, { status: 400 });
  }

  const room = await getRoomSnapshot(roomId, clientId);
  if (!room) {
    return NextResponse.json({ error: "Chat room not found." }, { status: 404 });
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(chatParticipants)
      .set({ leftAt: now, lastSeenAt: now })
      .where(
        and(
          eq(chatParticipants.roomId, roomId),
          eq(chatParticipants.clientId, clientId),
        ),
      );
    await tx
      .update(chatRooms)
      .set({ status: "ended", endedAt: now, updatedAt: now })
      .where(eq(chatRooms.id, roomId));
  });

  return NextResponse.json({ ok: true });
}
