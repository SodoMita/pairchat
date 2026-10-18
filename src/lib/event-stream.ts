import "server-only";
import { subscribe } from "@/lib/bus";
import { HttpError } from "@/lib/request-security";
const globals = globalThis as typeof globalThis & { __cbStreams?: Map<string, number>; __cbStreamTotal?: number };
const counts = globals.__cbStreams ??= new Map<string, number>();
type EventData = { type: string; [key: string]: unknown };

/** Bounded, cancellable live SSE. No transcript/replay queue on the relay. */
export function eventStream(req: Request, userId: string, scope: string, options: {
  initial?: () => Promise<EventData>;
  named?: boolean;
  expiresAt?: number;
} = {}): Response {
  if ((counts.get(userId) ?? 0) >= 6 || (globals.__cbStreamTotal ?? 0) >= 1000) throw new HttpError(429, "Too many streams", 10);
  counts.set(userId, (counts.get(userId) ?? 0) + 1);
  globals.__cbStreamTotal = (globals.__cbStreamTotal ?? 0) + 1;
  let cleanup = () => {};
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let booting = true;
      let pending: string[] = [];
      let pendingBytes = 0;
      const push = (event: string, value: EventData) => {
        if (closed) return false;
        const data = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
        if (data.length > 16_384 || (controller.desiredSize ?? 0) < data.length) { cleanup(); return false; }
        try { controller.enqueue(data); return true; } catch { cleanup(); return false; }
      };
      const deliver = (payload: string) => {
        const value = JSON.parse(payload) as EventData;
        const ok = push(options.named ? value.type : "message", value);
        if (["room_closed", "session_ended"].includes(value.type)) cleanup();
        return ok;
      };
      const unsubscribe = subscribe(scope, payload => {
        if (closed) return false;
        if (booting) {
          pendingBytes += payload.length;
          if (pendingBytes > 32_768) { cleanup(); return false; }
          pending.push(payload); return true;
        }
        return deliver(payload);
      }, userId);
      const heartbeat = setInterval(() => {
        if ((controller.desiredSize ?? 0) < 16) return cleanup();
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { cleanup(); }
      }, 25_000);
      const remaining = options.expiresAt === undefined ? Infinity : Math.max(0, options.expiresAt - Date.now());
      const lifetime = setTimeout(() => {
        if (remaining <= 20 * 60_000) push("fatal", { type: "fatal", error: "Session expired" });
        cleanup();
      }, Math.min(20 * 60_000, remaining));
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe(); clearInterval(heartbeat); clearTimeout(lifetime); pending = [];
        req.signal.removeEventListener("abort", cleanup);
        const next = (counts.get(userId) ?? 1) - 1;
        if (next > 0) counts.set(userId, next); else counts.delete(userId);
        globals.__cbStreamTotal = Math.max(0, (globals.__cbStreamTotal ?? 1) - 1);
        try { controller.close(); } catch { /* already cancelled */ }
      };
      req.signal.addEventListener("abort", cleanup, { once: true });
      if (req.signal.aborted) { cleanup(); return; }
      controller.enqueue(encoder.encode("retry: 5000\n\n"));
      void (async () => {
        try {
          if (options.initial) { const initial = await options.initial(); push(options.named ? initial.type : "message", initial); if (["room_closed", "session_ended"].includes(initial.type)) { cleanup(); return; } }
          booting = false;
          for (const payload of pending) deliver(payload);
          pending = []; pendingBytes = 0;
          push("ready", { type: "ready" });
        } catch { push("fatal", { type: "fatal", error: "Connection unavailable" }); cleanup(); }
      })();
    },
    cancel() { cleanup(); },
  }, { highWaterMark: 65_536, size: data => data.byteLength });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no",
  } });
}
