import { db } from "@/db";
import { abuseSignals, chatParticipants, chatReports, chatRooms } from "@/db/schema";
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
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const reportReasons = ["spam", "scam", "harassment", "unsafe"] as const;
type ReportReason = (typeof reportReasons)[number];

function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && reportReasons.includes(value as ReportReason);
}

function cooldownMilliseconds(score: number) {
  if (score >= 3) return 60 * 60_000;
  if (score === 2) return 15 * 60_000;
  return 5 * 60_000;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  if (!isTrustedJsonMutation(request)) {
    return NextResponse.json({ error: "Untrusted request." }, { status: 403 });
  }
  if (!allowRequest(`report:${requestClientAddress(request)}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many safety signals." }, { status: 429 });
  }

  const { roomId } = await context.params;
  const accessToken = bearerCredential(request);
  const accessHash = accessToken ? hashAccessCredential(accessToken) : null;
  const body = await readLimitedJson(request, 1_000);
  const targetPublicId = body?.targetPublicId;
  const reason = body?.reason;

  if (
    !isValidRoomId(roomId) ||
    !isValidClientId(accessToken) ||
    !isValidParticipantPublicId(targetPublicId) ||
    !isReportReason(reason)
  ) {
    return NextResponse.json({ error: "Invalid safety signal." }, { status: 400 });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const outcome = await db.transaction(async (tx) => {
    const [room] = await tx
      .select({ kind: chatRooms.kind })
      .from(chatRooms)
      .where(eq(chatRooms.id, roomId))
      .limit(1);
    if (!room || room.kind !== "random") return "missing" as const;

    const participants = await tx
      .select({
        accessHash: chatParticipants.clientId,
        publicId: chatParticipants.publicId,
        abuseSessionHash: chatParticipants.abuseSessionHash,
      })
      .from(chatParticipants)
      .where(eq(chatParticipants.roomId, roomId));

    const reporter = participants.find((participant) => participant.accessHash === accessHash);
    const target = participants.find((participant) => participant.publicId === targetPublicId);
    if (!reporter || !target || reporter.publicId === target.publicId) return "invalid" as const;
    if (!target.abuseSessionHash) return "unavailable" as const;

    const [inserted] = await tx
      .insert(chatReports)
      .values({
        roomId,
        reporterAccessHash: accessHash!,
        targetPublicId,
        reason,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: chatReports.id });
    if (!inserted) return "duplicate" as const;

    const [currentSignal] = await tx
      .select()
      .from(abuseSignals)
      .where(eq(abuseSignals.sessionHash, target.abuseSessionHash))
      .limit(1);
    const score = Math.min((currentSignal?.score ?? 0) + 1, 5);
    const cooldownUntil = new Date(now.getTime() + cooldownMilliseconds(score));
    const signalExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60_000);

    if (currentSignal) {
      await tx
        .update(abuseSignals)
        .set({ score, cooldownUntil, expiresAt: signalExpiresAt, updatedAt: now })
        .where(eq(abuseSignals.sessionHash, target.abuseSessionHash));
    } else {
      await tx.insert(abuseSignals).values({
        sessionHash: target.abuseSessionHash,
        score,
        cooldownUntil,
        expiresAt: signalExpiresAt,
      });
    }
    return "recorded" as const;
  });

  if (outcome === "missing") {
    return NextResponse.json({ error: "That stranger chat is unavailable." }, { status: 404 });
  }
  if (outcome === "invalid" || outcome === "unavailable") {
    return NextResponse.json({ error: "That safety signal is not available." }, { status: 403 });
  }
  if (outcome === "duplicate") {
    return NextResponse.json({ error: "You already sent a safety signal for this chat." }, { status: 409 });
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
