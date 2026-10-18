import { db } from "@/db";
import { chatParticipants, chatRooms } from "@/db/schema";
import {
  createRoomId,
  isValidClientId,
  isValidEcdsaPublicKey,
  isValidPrivateCommitment,
} from "@/lib/chat";
import { getRoomSnapshot } from "@/lib/chat-server";
import { allowRequest } from "@/lib/rate-limit";
import { bearerCredential, isTrustedJsonMutation, requestClientAddress, readLimitedJson } from "@/lib/request-security";
import { hashAccessCredential } from "@/lib/server-credentials";
import { sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  if (!isTrustedJsonMutation(request)) {
    return NextResponse.json({ error: "Untrusted request." }, { status: 403 });
  }
  if (!allowRequest(`room-create:${requestClientAddress(request)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many room requests." }, { status: 429 });
  }
  const body = await readLimitedJson(request);
  const clientId = bearerCredential(request);
  const signingKey = body?.signingKey;
  const keyCommitment = body?.keyCommitment;

  if (
    !isValidClientId(clientId) ||
    !isValidEcdsaPublicKey(signingKey) ||
    !isValidPrivateCommitment(keyCommitment)
  ) {
    return NextResponse.json({ error: "Invalid chat identity." }, { status: 400 });
  }

  const roomId = createRoomId("private");
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      delete from chat_rooms
      where (status = 'ended' and coalesce(ended_at, updated_at) < now() - interval '24 hours')
        or updated_at < now() - interval '7 days'
    `);
    await tx.insert(chatRooms).values({ id: roomId, kind: "private", keyCommitment });
    await tx.insert(chatParticipants).values({
      roomId,
      clientId: hashAccessCredential(clientId),
      seat: 1,
      signingKey,
    });
  });

  const room = await getRoomSnapshot(roomId, clientId, true);
  return NextResponse.json({ room }, { status: 201 });
}
