import { NextRequest } from "next/server";
import { subscribe } from "@/lib/bus";
import { consume } from "@/lib/rateLimit";
import { getOrCreateUser } from "@/lib/session";
import {
  getActiveStrangerSession,
  getUserName,
  userScope,
} from "@/lib/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET — Server-Sent Events: a single long-lived stream carrying everything
 * the stranger flow used to poll for.
 *
 *   state        current status on (re)connect: queued, or paired (+ key)
 *   paired       a partner was found
 *   partner_key  the partner published their public key
 *   partner_left the partner left
 *
 * One connection replaces a `/start` poll and a `/partner-key` poll that
 * each fired every 1.5s while waiting.
 */
export async function GET(req: NextRequest) {
  const user = await getOrCreateUser();

  const limit = consume(`stranger-events:${user.id}`, 10, 0.5);
  if (!limit.ok) {
    return Response.json(
      { error: "Rate limited" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      },
    );
  }

  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          /* stream closed */
        }
      };

      // Subscribe BEFORE reading state so an event published while we read
      // is not lost. Clients treat keys as monotonic, so a duplicate or
      // out-of-order delivery is harmless.
      const unsubscribe = subscribe(userScope(user.id), (payload: string) => {
        try {
          const parsed = JSON.parse(payload) as { type: string };
          send(parsed.type, parsed);
        } catch {
          /* ignore malformed */
        }
      });
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": hb\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", cleanup);

      try {
        const session = await getActiveStrangerSession(user.id);
        if (session) {
          send("state", {
            state: "paired",
            sessionId: session.sessionId,
            partnerId: session.partnerId,
            partnerName: session.partnerId
              ? await getUserName(session.partnerId)
              : null,
            partnerLeft: !session.partnerId,
            partnerKey: session.partnerIdentityPubKey,
          });
        } else {
          send("state", { state: "queued" });
        }
      } catch {
        send("error", { error: "state_failed" });
      }
    },
    cancel() {
      cleanup();
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
