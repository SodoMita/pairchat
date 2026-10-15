import { NextRequest } from "next/server";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { matchmaking, messages } from "@/db/schema";
import { getOrCreateUser } from "@/lib/session";
import {
  getActiveStrangerSession,
  postMessage,
  strangerScope,
} from "@/lib/chat";
import { subscribe, publish } from "@/lib/bus";
import { consume } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ sessionId: string }> };

/**
 * Verify the requesting user is actually part of this session.
 * Returns the other user id if valid, else null.
 */
async function authorizeSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(matchmaking)
    .where(eq(matchmaking.sessionId, sessionId));
  return rows.some((r) => r.userId === userId);
}

/**
 * POST — Send a message in the stranger session.
 */
export async function POST(req: NextRequest, ctx: RouteParams) {
  const { sessionId } = await ctx.params;
  const user = await getOrCreateUser();

  if (!(await authorizeSession(user.id, sessionId))) {
    return Response.json({ error: "Not in session" }, { status: 403 });
  }

  // Per-user rate limit. 6 msg/sec, burst of 20.
  const limit = consume(`stranger-msg:${user.id}`, 20, 6);
  if (!limit.ok) {
    return Response.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  let parsed: { text?: unknown; envelope?: unknown; ephemeralPubKey?: unknown };
  try {
    parsed = (await req.json()) as typeof parsed;
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }

  // Two ways to send a message:
  //   1) Legacy plaintext — for system messages and pre-encryption tests.
  //      Only allowed if the message has system_flag set later by the
  //      server (we don't accept it from clients).
  //   2) Encrypted envelope: client sends a JSON envelope body and an
  //      ephemeral X25519 public key so the partner can derive the
  //      matching AES-256-GCM key. The server stores it verbatim and
  //      cannot decrypt it.
  const envelope = parsed.envelope;
  const ephPub = parsed.ephemeralPubKey;
  if (
    typeof envelope !== "string" ||
    typeof ephPub !== "string" ||
    ephPub.length === 0 ||
    ephPub.length > 64
  ) {
    return Response.json(
      { error: "Encrypted message required" },
      { status: 400 },
    );
  }
  // Validate the envelope structure (cheap sanity check; the server
  // never tries to decrypt).
  try {
    const obj = JSON.parse(envelope);
    if (
      !obj ||
      typeof obj !== "object" ||
      obj.v !== 1 ||
      typeof obj.ct !== "string" ||
      typeof obj.iv !== "string"
    ) {
      return Response.json({ error: "Bad envelope" }, { status: 400 });
    }
    if (envelope.length > 8000)
      return Response.json({ error: "Too long" }, { status: 400 });
  } catch {
    return Response.json({ error: "Bad envelope" }, { status: 400 });
  }

  const msg = await postMessage({
    scope: strangerScope(sessionId),
    senderUserId: user.id,
    senderName: user.displayName,
    body: envelope,
    senderPubKey: ephPub,
  });

  publish(
    strangerScope(sessionId),
    JSON.stringify({ type: "message", message: msg }),
  );

  return Response.json({ message: msg });
}

/**
 * GET — Server-Sent Events stream of new messages for this session.
 * Also returns a snapshot of any messages created after `?since=ISO`.
 */
export async function GET(req: NextRequest, ctx: RouteParams) {
  const { sessionId } = await ctx.params;
  const user = await getOrCreateUser();

  // Even if not in session, we still stream a single error event and close.
  const inSession = await authorizeSession(user.id, sessionId);

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (data: string, event = "message") => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\n`));
          for (const line of data.split("\n")) {
            controller.enqueue(enc.encode(`data: ${line}\n`));
          }
          controller.enqueue(enc.encode("\n"));
        } catch {
          // controller closed
        }
      };

      const writeEvent = (payload: object, event = "message") => {
        send(JSON.stringify(payload), event);
      };

      // Initial ready event so the client knows the stream is alive.
      writeEvent({ type: "ready" }, "ready");

      if (!inSession) {
        writeEvent({ type: "error", error: "Not in session" }, "error");
        controller.close();
        return;
      }

      // Snapshot any messages created after `since`.
      (async () => {
        try {
          let rows;
          if (since && !Number.isNaN(since.getTime())) {
            rows = await db
              .select()
              .from(messages)
              .where(
                and(
                  eq(messages.scope, strangerScope(sessionId)),
                  gt(messages.createdAt, since),
                ),
              )
              .orderBy(asc(messages.createdAt));
          } else {
            rows = await db
              .select()
              .from(messages)
              .where(eq(messages.scope, strangerScope(sessionId)))
              .orderBy(asc(messages.createdAt));
          }
          for (const m of rows) {
            writeEvent({ type: "message", message: m }, "message");
          }
        } catch (err) {
          writeEvent({ type: "error", error: "snapshot_failed" }, "error");
        }
      })();

      // Heartbeat every 20s so proxies don't kill the connection.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: hb\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 20000);

      // Live subscriptions.
      const unsub = subscribe(strangerScope(sessionId), (payload: string) => {
        writeEvent(JSON.parse(payload), "message");
      });

      // Partner disconnect detection: when the other side deletes their
      // matchmaking row, surface a "partner_left" event.
      let partnerGone = false;
      const partnerCheck = setInterval(async () => {
        try {
          const session = await getActiveStrangerSession(user.id);
          if (!session || session.sessionId !== sessionId) {
            if (!partnerGone) {
              partnerGone = true;
              writeEvent({ type: "partner_left" }, "partner");
            }
            return;
          }
          // If partnerId went null, they left.
          if (!session.partnerId && !partnerGone) {
            partnerGone = true;
            writeEvent({ type: "partner_left" }, "partner");
          }
        } catch {
          // ignore
        }
      }, 3000);

      const cleanup = () => {
        clearInterval(heartbeat);
        clearInterval(partnerCheck);
        unsub();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}