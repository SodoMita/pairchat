import { db } from "@/db";
import { chatParticipants, chatRooms } from "@/db/schema";
import {
  isValidClientId,
  isValidEcdsaPublicKey,
  isValidPrivateCommitment,
  isValidRoomId,
} from "@/lib/chat";
import { notifyRoomJoined } from "@/lib/chat-events";
import { getRoomSnapshot } from "@/lib/chat-server";
import { allowRequest } from "@/lib/rate-limit";
import { bearerCredential, isTrustedJsonMutation, requestClientAddress, readLimitedJson } from "@/lib/request-security";
import { hashAccessCredential } from "@/lib/server-credentials";
import { and, eq, isNull, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  if (!isTrustedJsonMutation(request)) {
    return NextResponse.json({ error: "Untrusted request." }, { status: 403 });
  }
  // Scope the budget to this visitor, not to the address: behind a proxy that
  // omits the client address every visitor would share one small bucket.
  const joinIdentity = hashAccessCredential(
    bearerCredential(request) ?? requestClientAddress(request),
  );
  if (!allowRequest(`room-join:${joinIdentity}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many join requests." }, { status: 429 });
  }
  const { roomId } = await context.params;
  const body = await readLimitedJson(request);
  const clientId = bearerCredential(request);
  const signingKey = body?.signingKey;
  const keyCommitment = body?.keyCommitment;

  if (
    !isValidRoomId(roomId) ||
    !isValidClientId(clientId) ||
    !isValidEcdsaPublicKey(signingKey) ||
    !isValidPrivateCommitment(keyCommitment)
  ) {
    return NextResponse.json({ error: "Invalid invite link." }, { status: 400 });
  }

  const accessHash = hashAccessCredential(clientId);
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${roomId}))`);

    const [room] = await tx
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.id, roomId))
      .limit(1);

    if (!room || room.kind !== "private") return "missing" as const;
    if (!isValidPrivateCommitment(room.keyCommitment)) return "bad-secret" as const;
    const suppliedCommitment = Buffer.from(keyCommitment, "hex");
    const storedCommitment = Buffer.from(room.keyCommitment, "hex");
    if (!timingSafeEqual(suppliedCommitment, storedCommitment)) {
      return "bad-secret" as const;
    }

    const [existing] = await tx
      .select({ id: chatParticipants.id, signingKey: chatParticipants.signingKey })
      .from(chatParticipants)
      .where(
        and(
          eq(chatParticipants.roomId, roomId),
          eq(chatParticipants.clientId, accessHash),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.signingKey && existing.signingKey !== signingKey) {
        return "key-conflict" as const;
      }
      await tx
        .update(chatParticipants)
        .set({ lastSeenAt: new Date(), signingKey: existing.signingKey ?? signingKey })
        .where(eq(chatParticipants.id, existing.id));
      return "joined" as const;
    }

    if (room.status === "ended") return "ended" as const;

    const activeParticipants = await tx
      .select({ id: chatParticipants.id })
      .from(chatParticipants)
      .where(
        and(
          eq(chatParticipants.roomId, roomId),
          isNull(chatParticipants.leftAt),
        ),
      );

    if (activeParticipants.length >= 2 || room.status === "active") {
      return "full" as const;
    }

    await tx.insert(chatParticipants).values({
      roomId,
      clientId: accessHash,
      seat: 2,
      signingKey,
    });
    await tx
      .update(chatRooms)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(chatRooms.id, roomId));
    return "joined" as const;
  });

  if (outcome === "bad-secret") {
    return NextResponse.json({ error: "Invalid private invite secret." }, { status: 403 });
  }
  if (outcome === "key-conflict") {
    return NextResponse.json({ error: "Signing key does not match this participant." }, { status: 409 });
  }
  if (outcome === "missing") {
    return NextResponse.json({ error: "This invite does not exist." }, { status: 404 });
  }
  if (outcome === "ended") {
    return NextResponse.json({ error: "This chat has ended." }, { status: 410 });
  }
  if (outcome === "full") {
    return NextResponse.json({ error: "This private chat is already full." }, { status: 409 });
  }

  notifyRoomJoined(roomId);
  const room = await getRoomSnapshot(roomId, clientId, true);
  return NextResponse.json({ room });
}
