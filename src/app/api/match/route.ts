import { db } from "@/db";
import { ensureChatSchema } from "@/db/ensure";
import { abuseSignals, chatParticipants, chatReports, chatRooms } from "@/db/schema";
import {
  createRoomId,
  isValidAbuseSession,
  isValidClientId,
  isValidEcdhPublicKey,
  isValidEcdsaPublicKey,
} from "@/lib/chat";
import { getRoomSnapshot } from "@/lib/chat-server";
import { countParticipantStreams } from "@/lib/chat-events";
import { allowRequest } from "@/lib/rate-limit";
import {
  abuseSessionCredential,
  bearerCredential,
  isTrustedJsonMutation,
  readLimitedJson,
  requestClientAddress,
} from "@/lib/request-security";
import { hashAccessCredential } from "@/lib/server-credentials";
import { issueAdmissionChallenge, verifyAdmissionChallenge } from "@/lib/admission-challenge";
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
  const body = await readLimitedJson(request);
  const clientId = bearerCredential(request);
  const abuseSession = abuseSessionCredential(request);
  const publicKey = body?.publicKey;
  const signingKey = body?.signingKey;

  if (
    !isValidClientId(clientId) ||
    !isValidAbuseSession(abuseSession) ||
    !isValidEcdhPublicKey(publicKey) ||
    !isValidEcdsaPublicKey(signingKey)
  ) {
    return NextResponse.json({ error: "Invalid encrypted chat identity." }, { status: 400 });
  }

  await ensureChatSchema();
  const accessHash = hashAccessCredential(clientId);
  const abuseSessionHash = hashAccessCredential(abuseSession);
  // Some reverse proxies do not forward a client address. An address-only
  // bucket would then be shared by *every* visitor as "unknown".
  if (!allowRequest(`match-post:${requestClientAddress(request)}:${abuseSessionHash}`, 30, 60_000)) {
    return NextResponse.json(
      { code: "request-limit", error: "Too many match requests." },
      { status: 429 },
    );
  }

  // Normal use gets a quiet budget; bursts must solve a local proof-of-work
  // challenge issued and verified by this server. No third-party scripts.
  // A few retries after cancelling a search should not immediately force a
  // proof-of-work challenge (the stricter 3-attempt budget broke normal use).
  const withinQuietBudget = allowRequest(`match-quiet:${abuseSessionHash}`, 24, 10 * 60_000);
  if (!withinQuietBudget) {
    const challengeSolved = verifyAdmissionChallenge(body?.challenge, abuseSessionHash);
    if (!challengeSolved) {
      return NextResponse.json(
        {
          error: "Please complete the admission check.",
          challenge: issueAdmissionChallenge(abuseSessionHash),
        },
        { status: 428 },
      );
    }
  }

  const roomId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7402181)`);
    // A hidden/closed search stops polling. Close its seat before it can be
    // matched to a stranger who would otherwise wait for a non-existent peer.
    await tx.execute(sql`
      update chat_rooms as rooms
      set status = 'ended', ended_at = now(), updated_at = now()
      where rooms.kind = 'random'
        and rooms.status = 'waiting'
        and not exists (
          select 1 from chat_participants as member
          where member.room_id = rooms.id
            and member.left_at is null
            and member.last_seen_at > now() - interval '90 seconds'
        )
    `);
    // Back-to-chats does not keep a relay open. Forgotten active rooms must
    // stop consuming the per-browser active-room limit indefinitely.
    await tx.execute(sql`
      update chat_rooms as room
      set status = 'ended', ended_at = now(), updated_at = now()
      where room.kind = 'random'
        and room.status = 'active'
        and not exists (
          select 1 from chat_participants as member
          where member.room_id = room.id
            and member.left_at is null
            and member.last_seen_at > now() - interval '2 minutes'
        )
    `);
    await tx.execute(sql`
      delete from chat_rooms
      where (status = 'ended' and coalesce(ended_at, updated_at) < now() - interval '24 hours')
        or updated_at < now() - interval '7 days'
    `);
    await tx.delete(chatReports).where(sql`${chatReports.expiresAt} <= now()`);
    await tx.delete(abuseSignals).where(sql`${abuseSignals.expiresAt} <= now()`);

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
          eq(chatParticipants.clientId, accessHash),
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
            eq(chatParticipants.clientId, accessHash),
          ),
        );
      await tx
        .update(chatRooms)
        .set({ updatedAt: now })
        .where(eq(chatRooms.id, existing.roomId));
      return existing.roomId;
    }

    const now = new Date();
    const [signal] = await tx
      .select({ cooldownUntil: abuseSignals.cooldownUntil })
      .from(abuseSignals)
      .where(eq(abuseSignals.sessionHash, abuseSessionHash))
      .limit(1);
    if (signal?.cooldownUntil && signal.cooldownUntil > now) {
      return "session-cooldown" as const;
    }

    const [sessionWaiting] = await tx
      .select({
        roomId: chatRooms.id,
        waitingClientId: chatParticipants.clientId,
        lastSeenAt: chatParticipants.lastSeenAt,
      })
      .from(chatParticipants)
      .innerJoin(chatRooms, eq(chatParticipants.roomId, chatRooms.id))
      .where(
        and(
          eq(chatParticipants.abuseSessionHash, abuseSessionHash),
          eq(chatRooms.kind, "random"),
          eq(chatRooms.status, "waiting"),
          isNull(chatParticipants.leftAt),
        ),
      )
      .limit(1);
    // A seat counts as a person only while its owner still holds the relay
    // stream open. A tab that reloaded past its local key, or closed, leaves a
    // row behind; joining that row would mark a room active with nobody in it.
    const waitingSeatIsLive = Boolean(
      sessionWaiting &&
        now.getTime() - sessionWaiting.lastSeenAt.getTime() < 45_000 &&
        countParticipantStreams(sessionWaiting.roomId, sessionWaiting.waitingClientId) > 0,
    );
    if (
      sessionWaiting &&
      waitingSeatIsLive &&
      sessionWaiting.waitingClientId !== accessHash
    ) {
      // A second tab in this browser is still searching. Pair them instead of
      // killing the first search — otherwise a solo tester can never connect.
      await tx.insert(chatParticipants).values({
        roomId: sessionWaiting.roomId,
        clientId: accessHash,
        abuseSessionHash,
        seat: 2,
        publicKey,
        signingKey,
      });
      await tx
        .update(chatRooms)
        .set({ status: "active", updatedAt: now })
        .where(eq(chatRooms.id, sessionWaiting.roomId));
      return sessionWaiting.roomId;
    }
    if (sessionWaiting) {
      // The same tab reloaded without its local key, or the seat outlived its
      // owner. Close the old waiting seat; never claim its credential.
      await tx
        .update(chatParticipants)
        .set({ leftAt: now, lastSeenAt: now })
        .where(
          and(
            eq(chatParticipants.roomId, sessionWaiting.roomId),
            eq(chatParticipants.abuseSessionHash, abuseSessionHash),
            isNull(chatParticipants.leftAt),
          ),
        );
      await tx
        .update(chatRooms)
        .set({ status: "ended", endedAt: now, updatedAt: now })
        .where(
          and(
            eq(chatRooms.id, sessionWaiting.roomId),
            eq(chatRooms.status, "waiting"),
          ),
        );
    }

    const activeRooms = await tx
      .select({ roomId: chatRooms.id })
      .from(chatParticipants)
      .innerJoin(chatRooms, eq(chatParticipants.roomId, chatRooms.id))
      .where(
        and(
          eq(chatParticipants.abuseSessionHash, abuseSessionHash),
          eq(chatRooms.kind, "random"),
          eq(chatRooms.status, "active"),
          isNull(chatParticipants.leftAt),
        ),
      )
      .limit(4);
    if (activeRooms.length >= 3) return "session-limit" as const;

    const [{ recentContacts }] = await tx
      .select({ recentContacts: sql<number>`count(*)::int` })
      .from(chatParticipants)
      .innerJoin(chatRooms, eq(chatParticipants.roomId, chatRooms.id))
      .where(
        and(
          eq(chatParticipants.abuseSessionHash, abuseSessionHash),
          eq(chatRooms.kind, "random"),
          sql`${chatParticipants.joinedAt} > now() - interval '1 hour'`,
          // A cancelled/expired wait is not a meeting. Count only rooms with
          // an actual second seat, even if the conversation later ended.
          sql`exists (
            select 1 from chat_participants as peer
            where peer.room_id = ${chatParticipants.roomId} and peer.seat = 2
          )`,
        ),
      );
    if (recentContacts >= 20) return "contact-budget" as const;

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
          ne(chatParticipants.clientId, accessHash),
          sql`${chatParticipants.lastSeenAt} > now() - interval '45 seconds'`,
        ),
      )
      .orderBy(asc(chatRooms.createdAt))
      .limit(1);

    if (waiting) {
      await tx.insert(chatParticipants).values({
        roomId: waiting.roomId,
        clientId: accessHash,
        abuseSessionHash,
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
      clientId: accessHash,
      abuseSessionHash,
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
  if (roomId === "session-cooldown") {
    return NextResponse.json(
      { code: "cooldown", error: "Matching is temporarily paused for this browser." },
      { status: 429 },
    );
  }
  if (roomId === "contact-budget") {
    return NextResponse.json(
      {
        code: "contact-limit",
        error: "This browser has met new strangers too quickly. Please try again later.",
      },
      { status: 429 },
    );
  }
  if (roomId === "session-limit") {
    return NextResponse.json(
      {
        code: "active-limit",
        error: "This browser has reached the active stranger chat limit.",
      },
      { status: 429 },
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
  await ensureChatSchema();
  const accessHash = hashAccessCredential(clientId);
  if (!allowRequest(`match-poll:${requestClientAddress(request)}:${accessHash}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many polling requests." }, { status: 429 });
  }

  const [match] = await db
    .select({ roomId: chatRooms.id })
    .from(chatParticipants)
    .innerJoin(chatRooms, eq(chatParticipants.roomId, chatRooms.id))
    .where(
      and(
        eq(chatParticipants.clientId, accessHash),
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
