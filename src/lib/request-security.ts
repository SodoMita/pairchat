import "server-only";
import { isIP } from "node:net";
import { consume } from "@/lib/rateLimit";

export class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

export function limit(key: string, capacity: number, refill: number) {
  const result = consume(key, capacity, refill);
  if (!result.ok) throw new HttpError(429, "Too many requests. Please wait.", Math.ceil(result.retryAfterMs / 1000));
}

export function assertOrigin(req: Request) {
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Cross-site request rejected");
  const origin = req.headers.get("origin");
  if (!origin) return; // Non-browser API clients; browser forms carry Origin/Fetch Metadata.
  try {
    const parsed = new URL(origin);
    const allowed = process.env.APP_ORIGIN;
    if (allowed ? parsed.origin !== new URL(allowed).origin : parsed.host !== req.headers.get("host")) {
      throw new Error("Origin mismatch");
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Invalid scheme");
  } catch { throw new HttpError(403, "Cross-origin request rejected"); }
}

// Do not trust arbitrary X-Forwarded-For supplied by a client. Enable a
// single-address header ONLY when the deployment ingress strips/overwrites it.
export function admissionKey(req: Request): string {
  const header = process.env.TRUSTED_CLIENT_IP_HEADER;
  const address = header ? req.headers.get(header)?.trim() : undefined;
  return address && isIP(address) ? address : "shared-untrusted-ingress";
}

/** Count bytes while streaming, before buffering or JSON parsing. */
export async function readJson(req: Request, maxBytes = 12_000, optional = false): Promise<Record<string, unknown>> {
  const length = req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new HttpError(413, "Request too large");
  if (!req.body) {
    if (optional) return {};
    throw new HttpError(400, "JSON object required");
  }
  const isJson = (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
  if (!isJson && !optional) throw new HttpError(415, "Use application/json");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const timeout = setTimeout(() => { void reader.cancel().catch(() => {}); }, 10_000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { void reader.cancel().catch(() => {}); throw new HttpError(413, "Request too large"); }
      chunks.push(value);
    }
    if (!total && optional) return {};
    if (!isJson) throw new HttpError(415, "Use application/json");
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Not an object");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON object");
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}

export function api<T>(handler: (req: Request, context: T) => Promise<Response>) {
  return async (req: Request, context: T) => {
    try {
      assertOrigin(req);
      const response = await handler(req, context);
      response.headers.set("Cache-Control", "no-store, no-transform");
      return response;
    } catch (error) {
      const known = error instanceof HttpError;
      return Response.json({ error: known ? error.message : "Service temporarily unavailable" }, {
        status: known ? error.status : 503,
        headers: { "Cache-Control": "no-store", ...(known && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) },
      });
    }
  };
}
