import { db } from "@/db";
import { chatParticipants } from "@/db/schema";
import {
  subscribeToChatMessages,
  type LiveChatEvent,
} from "@/lib/chat-events";
import { isValidClientId, isValidRoomId } from "@/lib/chat";
import { allowRequest } from "@/lib/rate-limit";
import { bearerCredential, requestClientAddress } from "@/lib/request-security";
import { and, eq, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await context.params;
  const clientId = bearerCredential(request);

  if (!isValidRoomId(roomId) || !isValidClientId(clientId)) {
    return NextResponse.json({ error: "Invalid event stream request." }, { status: 400 });
  }
  if (!allowRequest(`events:${requestClientAddress(request)}:${clientId}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many stream requests." }, { status: 429 });
  }

  const [membership] = await db
    .select({ id: chatParticipants.id })
    .from(chatParticipants)
    .where(
      and(
        eq(chatParticipants.roomId, roomId),
        eq(chatParticipants.clientId, clientId),
        isNull(chatParticipants.leftAt),
      ),
    )
    .limit(1);

  if (!membership) {
    return NextResponse.json({ error: "You are not in this active chat." }, { status: 403 });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const send = (event: LiveChatEvent) => {
        if (closed) return;
        try {
          const payload = event.type === "message" ? event.message : { connected: event.connected };
          const id = event.type === "message" ? `id: ${event.message.id}\n` : "";
          controller.enqueue(
            encoder.encode(
              `${id}event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`,
            ),
          );
        } catch {
          cleanup();
        }
      };

      const unsubscribe = subscribeToChatMessages(roomId, clientId, send);
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // The browser may have already closed the stream.
        }
      };
      cleanup = close;
      request.signal.addEventListener("abort", close, { once: true });
      controller.enqueue(encoder.encode("retry: 1000\n: encrypted-relay-connected\n\n"));

      heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            close();
          }
        }
      }, 15_000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Referrer-Policy": "no-referrer",
    },
  });
}
