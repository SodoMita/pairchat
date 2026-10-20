import { db } from "@/db";
import { agentChannels } from "@/db/schema";
import {
  isValidAuthHash,
  isValidMayflyId,
  sweepExpiredAgentChannels,
} from "@/lib/agent-channels";
import { allowRequest } from "@/lib/rate-limit";
import { requestClientAddress } from "@/lib/request-security";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function isAllowedCreationOrigin(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const candidateHosts = [
      ...(request.headers.get("x-forwarded-host")?.split(",") ?? []),
      request.headers.get("host") ?? "",
      request.nextUrl.host,
    ].map((host) => host.trim().toLowerCase());
    return candidateHosts.includes(originUrl.host.toLowerCase());
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedCreationOrigin(request)) {
    return new Response("Cross-origin channel creation refused.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json({ error: "Expected application/json." }, { status: 400 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > 4096) {
    return NextResponse.json({ error: "Request body exceeds 4 KiB." }, { status: 413 });
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return NextResponse.json({ error: "Missing request body." }, { status: 400 });
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 4096) {
        await reader.cancel().catch(() => {});
        return NextResponse.json({ error: "Request body exceeds 4 KiB." }, { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return NextResponse.json({ error: "Invalid request stream." }, { status: 400 });
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  if (!isValidMayflyId(body.id) || !isValidAuthHash(body.auth_hash)) {
    return NextResponse.json({ error: "Invalid channel id or auth_hash." }, { status: 400 });
  }

  const ip = requestClientAddress(request);
  if (!allowRequest(`agent-channel-new:${ip}`, 100, 60 * 60_000)) {
    return NextResponse.json({ error: "Channel creation rate limit exceeded." }, { status: 429 });
  }

  await sweepExpiredAgentChannels();

  const inserted = await db
    .insert(agentChannels)
    .values({
      id: body.id,
      authHash: body.auth_hash,
    })
    .onConflictDoNothing()
    .returning({ id: agentChannels.id });

  if (inserted.length === 0) {
    return NextResponse.json({ error: "Channel ID already exists." }, { status: 409 });
  }

  const path = `/c/${body.id}`;
  return new Response(path, {
    status: 303,
    headers: {
      Location: path,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
