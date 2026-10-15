import { db } from "@/db";
import { chatParticipants, chatRooms } from "@/db/schema";
import type { RoomKind, RoomSnapshot, RoomStatus } from "@/lib/chat";
import { hashAccessCredential } from "@/lib/server-credentials";
import { and, asc, eq } from "drizzle-orm";

export async function getRoomSnapshot(
  roomId: string,
  clientId: string,
  touch = false,
): Promise<RoomSnapshot | null> {
  const accessHash = hashAccessCredential(clientId);
  const [membership] = await db
    .select({
      id: chatParticipants.id,
      publicId: chatParticipants.publicId,
      leftAt: chatParticipants.leftAt,
    })
    .from(chatParticipants)
    .where(
      and(
        eq(chatParticipants.roomId, roomId),
        eq(chatParticipants.clientId, accessHash),
      ),
    )
    .limit(1);

  if (!membership) return null;

  if (touch && !membership.leftAt) {
    const now = new Date();
    await Promise.all([
      db
        .update(chatParticipants)
        .set({ lastSeenAt: now })
        .where(eq(chatParticipants.id, membership.id)),
      db
        .update(chatRooms)
        .set({ updatedAt: now })
        .where(eq(chatRooms.id, roomId)),
    ]);
  }

  const [room] = await db
    .select()
    .from(chatRooms)
    .where(eq(chatRooms.id, roomId))
    .limit(1);

  if (!room) return null;

  const participants = await db
    .select({
      clientId: chatParticipants.clientId,
      publicId: chatParticipants.publicId,
      publicKey: chatParticipants.publicKey,
      signingKey: chatParticipants.signingKey,
      leftAt: chatParticipants.leftAt,
      lastSeenAt: chatParticipants.lastSeenAt,
    })
    .from(chatParticipants)
    .where(eq(chatParticipants.roomId, roomId))
    .orderBy(asc(chatParticipants.seat));

  const partner = participants.find(
    (participant) => participant.clientId !== accessHash && !participant.leftAt,
  );
  const partnerOnline = Boolean(
    partner && Date.now() - partner.lastSeenAt.getTime() < 15_000,
  );

  return {
    id: room.id,
    kind: room.kind as RoomKind,
    status: room.status as RoomStatus,
    participantPublicId: membership.publicId,
    partnerPublicId: partner?.publicId ?? null,
    partnerPresent: Boolean(partner),
    partnerOnline,
    partnerPublicKey: partner?.publicKey ?? null,
    partnerSigningKey: partner?.signingKey ?? null,
    participantActive: !membership.leftAt,
    createdAt: room.createdAt.toISOString(),
  };
}
