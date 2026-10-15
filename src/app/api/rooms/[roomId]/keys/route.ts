import { db } from "@/db";
import { chatParticipants } from "@/db/schema";
import { isValidClientId, isValidEcdsaPublicKey, isValidRoomId } from "@/lib/chat";
import { getRoomSnapshot } from "@/lib/chat-server";
import { allowRequest } from "@/lib/rate-limit";
import { bearerCredential, isTrustedJsonMutation, requestClientAddress, readLimitedJson } from "@/lib/request-security";
import { hashAccessCredential } from "@/lib/server-credentials";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  if (!isTrustedJsonMutation(request)) {
    return NextResponse.json({ error: "Untrusted request." }, { status: 403 });
  }
  if (!allowRequest(`signing-key:${requestClientAddress(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many key requests." }, { status: 429 });
  }

  const { roomId } = await context.params;
  const body = await readLimitedJson(request);
  const clientId = bearerCredential(request);
  const signingKey = body?.signingKey;

  if (
    !isValidRoomId(roomId) ||
    !isValidClientId(clientId) ||
    !isValidEcdsaPublicKey(signingKey)
  ) {
    return NextResponse.json({ error: "Invalid signing key." }, { status: 400 });
  }

  const accessHash = hashAccessCredential(clientId);
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${roomId}))`);
    const [participant] = await tx
      .select({ id: chatParticipants.id, signingKey: chatParticipants.signingKey })
      .from(chatParticipants)
      .where(
        and(
          eq(chatParticipants.roomId, roomId),
          eq(chatParticipants.clientId, accessHash),
        ),
      )
      .limit(1);

    if (!participant) return "missing" as const;
    if (participant.signingKey && participant.signingKey !== signingKey) {
      return "conflict" as const;
    }
    if (!participant.signingKey) {
      await tx
        .update(chatParticipants)
        .set({ signingKey })
        .where(eq(chatParticipants.id, participant.id));
    }
    return "registered" as const;
  });

  if (outcome === "missing") {
    return NextResponse.json({ error: "Chat room not found." }, { status: 404 });
  }
  if (outcome === "conflict") {
    return NextResponse.json(
      { error: "Signing key does not match this participant." },
      { status: 409 },
    );
  }

  const room = await getRoomSnapshot(roomId, clientId, true);
  return NextResponse.json({ room });
}
