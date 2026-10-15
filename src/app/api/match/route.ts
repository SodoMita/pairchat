import { db } from "@/db";
import { chatParticipants, chatRooms } from "@/db/schema";
import { createRoomId, isValidClientId, isValidEcdhPublicKey, isValidEcdsaPublicKey } from "@/lib/chat";
import { getRoomSnapshot } from "@/lib/chat-server";
import { allowRequest } from "@/lib/rate-limit";
import { bearerCredential, isTrustedJsonMutation, readLimitedJson, requestClientAddress } from "@/lib/request-security";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isTrustedJsonMutation(request)) {
    return NextResponse.json({ error: "Untrusted request." }, { status: 403 });
  }
  if (!allowRequest(`match-post:${requestClientAddress(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many match requests." }, { status: 429 });
  }
  const body = await readLimitedJson(request);
  const clientId = body?.clientId;
  const publicKey = body?.publicKey;
  const signingKey = body?.signingKey;

  if (!isValidClientId(clientId) || !isValidEcdhPublicKey(publicKey) || !isValidEcdsaPublicKey(signingKey)) {
    return NextResponse.json({ error: "Invalid encrypted chat identity." }, { status: 400 });
  }

  const roomId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7402181)`);
    await tx.execute(sql`
      update chat_rooms
      set status = 'ended', ended_at = now(), updated_at = now()
      where kind = 'random'
        and status = 'waiting'
        and updated_at < now() - interval '25 seconds'
    `);
    await tx.execute(sql`
      delete from chat_rooms
      where (status = 'ended' and coalesce(ended_at, updated_at) < now() - interval '24 hours')
        or updated_at < now() - interval '7 days'
    `);

    const [existing] = await tx
      .select({
        roomId: chatRooms.id,
        publicKey: chatParticipants.publicKey,
        signingKey: chatParticipants.signingKey,
      })
      .from(chatParticipants)
      .innerJoin(chatRooms, eq(chatParticipants.roomId, chatRooms.id))
      .where(
        and(
          eq(chatParticipants.clientId, clientId),
          isNull(chatParticipants.leftAt),
          eq(chatRooms.kind, "random"),
          inArray(chatRooms.status, ["waiting", "active"]),
        ),
      )
      .orderBy(desc(chatRooms.createdAt))
      .limit(1);

    if (existing) {
      if (
        (existing.signingKey && existing.signingKey !== signingKey) ||
        (existing.publicKey && existing.publicKey !== publicKey)
      ) {
        return "key-conflict" as const;
      }
      const now = new Date();
      await tx
        .update(chatParticipants)
        .set({ lastSeenAt: now, publicKey, signingKey: existing.signingKey ?? signingKey })
        .where(
          and(
            eq(chatParticipants.roomId, existing.roomId),
            eq(chatParticipants.clientId, clientId),
          ),
        );
      await tx
        .update(chatRooms)
        .set({ updatedAt: now })
        .where(eq(chatRooms.id, existing.roomId));
      return existing.roomId;
    }

    const [waiting] = await tx
      .select({ roomId: chatRooms.id })
      .from(chatRooms)
      .innerJoin(
        chatParticipants,
        and(
          eq(chatParticipants.roomId, chatRooms.id),
          eq(chatParticipants.seat, 1),
        ),
      )
      .where(
        and(
          eq(chatRooms.kind, "random"),
          eq(chatRooms.status, "waiting"),
          isNull(chatParticipants.leftAt),
          isNotNull(chatParticipants.publicKey),
          isNotNull(chatParticipants.signingKey),
          ne(chatParticipants.clientId, clientId),
        ),
      )
      .orderBy(asc(chatRooms.createdAt))
      .limit(1);

    if (waiting) {
      await tx.insert(chatParticipants).values({
        roomId: waiting.roomId,
        clientId,
        seat: 2,
        publicKey,
        signingKey,
      });
      await tx
        .update(chatRooms)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(chatRooms.id, waiting.roomId));
      return waiting.roomId;
    }

    const id = createRoomId("random");
    await tx.insert(chatRooms).values({ id, kind: "random" });
    await tx.insert(chatParticipants).values({
      roomId: id,
      clientId,
      seat: 1,
      publicKey,
      signingKey,
    });
    return id;
  });

  if (roomId === "key-conflict") {
    return NextResponse.json(
      { error: "Signing key does not match this participant." },
      { status: 409 },
    );
  }
  const room = await getRoomSnapshot(roomId, clientId, true);
  return NextResponse.json({ room });
}

export async function GET(request: NextRequest) {
  const clientId = bearerCredential(request);

  if (!isValidClientId(clientId)) {
    return NextResponse.json({ error: "Invalid chat identity." }, { status: 400 });
  }
  if (!allowRequest(`match-poll:${requestClientAddress(request)}:${clientId}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many polling requests." }, { status: 429 });
  }

  const [match] = await db
    .select({ roomId: chatRooms.id })
    .from(chatParticipants)
    .innerJoin(chatRooms, eq(chatParticipants.roomId, chatRooms.id))
    .where(
      and(
        eq(chatParticipants.clientId, clientId),
        isNull(chatParticipants.leftAt),
        eq(chatRooms.kind, "random"),
        inArray(chatRooms.status, ["waiting", "active"]),
      ),
    )
    .orderBy(desc(chatRooms.createdAt))
    .limit(1);

  if (!match) return NextResponse.json({ room: null });

  const room = await getRoomSnapshot(match.roomId, clientId, true);
  return NextResponse.json({ room });
}
