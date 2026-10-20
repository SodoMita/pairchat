import {
  appendChannelEvent,
  isValidMayflyId,
  MAX_EVENT_BODY_BYTES,
  MAX_EVENT_CT_BYTES,
  MAX_WAIT_SECONDS,
  parseBase64UrlBytes,
  readChannelPage,
  waitForAgentChannelActivity,
} from "@/lib/agent-channels";
import { bearerCredential, requestClientAddress } from "@/lib/request-security";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function parseNonNegativeCap(raw: string | null, fallback: number, max: number): number | null {
  if (raw === null) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return Math.min(n, max);
}

function parseCursor(raw: string | null, required: boolean): number | null {
  if (raw === null) return required ? null : -1;
  if (!/^-?(?:0|[1-9][0-9]*)$/u.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < -1) return null;
  return n;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await context.params;
  if (!isValidMayflyId(channelId)) {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }

  const since = parseCursor(request.nextUrl.searchParams.get("since"), false);
  const wait = parseNonNegativeCap(request.nextUrl.searchParams.get("wait"), 0, MAX_WAIT_SECONDS);
  if (since === null || wait === null) {
    return NextResponse.json({ error: "Invalid since or wait query parameter." }, { status: 400 });
  }

  const bearer = bearerCredential(request);
  let result = await readChannelPage(channelId, bearer, since);
  if (result.status === 404) {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }
  if (result.status === 401) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (result.page.events.length === 0 && wait > 0) {
    const deadline = Date.now() + wait * 1000;
    while (Date.now() < deadline) {
      const outcome = await waitForAgentChannelActivity(
        channelId,
        deadline - Date.now(),
        request.signal,
      );
      if (outcome === "aborted") break;
      result = await readChannelPage(channelId, bearer, since);
      if (result.status === 404) {
        return NextResponse.json({ error: "Channel not found." }, { status: 404 });
      }
      if (result.status === 401) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
      }
      if (result.page.events.length > 0 || outcome === "timeout") break;
    }
  }

  return NextResponse.json(result.page, { status: 200 });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ channelId: string }> },
) {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return NextResponse.json({ error: "Cross-origin write refused." }, { status: 403 });
  }

  const { channelId } = await context.params;
  if (!isValidMayflyId(channelId)) {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }

  const last = parseCursor(request.nextUrl.searchParams.get("last"), true);
  const wait = parseNonNegativeCap(request.nextUrl.searchParams.get("wait"), 0, MAX_WAIT_SECONDS);
  if (last === null || wait === null) {
    return NextResponse.json({ error: "Missing or invalid last/wait query parameter." }, { status: 400 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_EVENT_BODY_BYTES) {
    return NextResponse.json({ error: "Event body exceeds size limit." }, { status: 413 });
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return NextResponse.json({ error: "Missing JSON body." }, { status: 400 });
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_EVENT_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return NextResponse.json({ error: "Event body exceeds size limit." }, { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return NextResponse.json({ error: "Invalid request stream." }, { status: 400 });
  }

  const raw = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: Record<string, unknown>;
  try {
    const candidate: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("not object");
    }
    parsed = candidate as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const nonceBytes = parseBase64UrlBytes(parsed.nonce);
  const ctBytes = parseBase64UrlBytes(parsed.ct);
  if (!nonceBytes || nonceBytes.byteLength !== 12 || !ctBytes || ctBytes.byteLength < 16) {
    return NextResponse.json({ error: "Invalid nonce or ciphertext." }, { status: 400 });
  }
  if (ctBytes.byteLength > MAX_EVENT_CT_BYTES) {
    return NextResponse.json({ error: "Ciphertext exceeds 512 KiB limit." }, { status: 413 });
  }

  const bearer = bearerCredential(request);
  const writeResult = await appendChannelEvent({
    channelId,
    bearer,
    last,
    nonce: parsed.nonce as string,
    ct: parsed.ct as string,
    ctBytes: ctBytes.byteLength,
    src: requestClientAddress(request),
  });

  if (writeResult.kind === "not_found") {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }
  if (writeResult.kind === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (writeResult.kind === "budget_exceeded") {
    return NextResponse.json({ error: "Channel event or byte budget exhausted." }, { status: 429 });
  }
  if (writeResult.kind === "conflict") {
    return NextResponse.json(
      {
        error: "conflict",
        posted: false,
        ...writeResult.page,
      },
      { status: 409 },
    );
  }

  const committedId = writeResult.id;
  let followUp = await readChannelPage(channelId, bearer, committedId);
  if (followUp.status === 200 && followUp.page.events.length === 0 && wait > 0) {
    const deadline = Date.now() + wait * 1000;
    while (Date.now() < deadline) {
      const outcome = await waitForAgentChannelActivity(
        channelId,
        deadline - Date.now(),
        request.signal,
      );
      if (outcome === "aborted") break;
      const nextRead = await readChannelPage(channelId, bearer, committedId);
      if (nextRead.status !== 200) break;
      followUp = nextRead;
      if (followUp.page.events.length > 0 || outcome === "timeout") break;
    }
  }

  const page =
    followUp.status === 200
      ? followUp.page
      : { last: committedId, more: false, events: [] };

  return NextResponse.json(
    {
      posted: true,
      id: committedId,
      ...page,
    },
    { status: 200 },
  );
}
