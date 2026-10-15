import { NextRequest } from "next/server";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { messages, rooms } from "@/db/schema";
import { getOrCreateUser } from "@/lib/session";
import { postMessage, roomScope, closeRoom } from "@/lib/chat";
import { subscribe, publish } from "@/lib/bus";
import { consume } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getOpenRoom(id: string) {
  if (!UUID_RE.test(id)) return null;
  const rows = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.id, id), isNull(rooms.closedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * POST — Send a message into the room. Authorization: the user must be
 * either the host or the seated guest. Anyone else gets 403.
 */
export async function POST(req: NextRequest, ctx: RouteParams) {
  const { id } = await ctx.params;
  const user = await getOrCreateUser();
  const room = await getOpenRoom(id);
  if (!room) return Response.json({ error: "Room closed" }, { status: 404 });

  const isHost = room.hostUserId === user.id;
  const isGuest = room.joinedUserId === user.id;
  if (!isHost && !isGuest) {
    return Response.json({ error: "Not a participant" }, { status: 403 });
  }

  const limit = consume(`room-msg:${user.id}`, 20, 6);
  if (!limit.ok) {
    return Response.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  let parsed: { envelope?: unknown };
  try {
    parsed = (await req.json()) as typeof parsed;
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }

  // Encrypted envelope required — the server never sees plaintext.
  const envelope = parsed.envelope;
  if (typeof envelope !== "string") {
    return Response.json(
      { error: "Encrypted message required" },
      { status: 400 },
    );
  }
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
    scope: roomScope(id),
    senderUserId: user.id,
    senderName: user.displayName,
    body: envelope,
  });

  publish(roomScope(id), JSON.stringify({ type: "message", message: msg }));

  return Response.json({ message: msg });
}

/**
 * GET — SSE stream of room messages.
 */
export async function GET(req: NextRequest, ctx: RouteParams) {
  const { id } = await ctx.params;
  const room = await getOpenRoom(id);
  if (!room) {
    return new Response("event: error\ndata: closed\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const user = await getOrCreateUser();
  const isParticipant = room.hostUserId === user.id || room.joinedUserId === user.id;
  if (!isParticipant) {
    return new Response("event: error\ndata: forbidden\n\n", {
      status: 403,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const writeEvent = (payload: object, event = "message") => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\n`));
          controller.enqueue(
            enc.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          // closed
        }
      };

      writeEvent({ type: "ready" }, "ready");

      (async () => {
        try {
          let rows;
          if (since && !Number.isNaN(since.getTime())) {
            rows = await db
              .select()
              .from(messages)
              .where(
                and(
                  eq(messages.scope, roomScope(id)),
                  gt(messages.createdAt, since),
                ),
              )
              .orderBy(asc(messages.createdAt));
          } else {
            rows = await db
              .select()
              .from(messages)
              .where(eq(messages.scope, roomScope(id)))
              .orderBy(asc(messages.createdAt));
          }
          for (const m of rows) writeEvent({ type: "message", message: m }, "message");
        } catch {
          writeEvent({ type: "error", error: "snapshot_failed" }, "error");
        }
      })();

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: hb\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 20000);

      const unsub = subscribe(roomScope(id), (payload: string) => {
        writeEvent(JSON.parse(payload), "message");
      });

      const cleanup = () => {
        clearInterval(heartbeat);
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