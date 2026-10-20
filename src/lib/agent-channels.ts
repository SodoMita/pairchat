import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { ensureChatSchema } from "@/db/ensure";
import { agentChannelEvents, agentChannels } from "@/db/schema";
import { and, asc, eq, gt, sql } from "drizzle-orm";

export const MAX_EVENT_CT_BYTES = 512 * 1024;
export const MAX_CHANNEL_BYTES = 1024 * 1024;
export const MAX_CHANNEL_EVENTS = 10_000;
export const MAX_PAGE_EVENTS = 500;
export const MAX_PAGE_BYTES = 1024 * 1024;
export const MAX_WAIT_SECONDS = 86_400;
export const MAX_EVENT_BODY_BYTES = 700_074;

type Waiter = () => void;
type ChannelWaitRegistry = Map<string, Set<Waiter>>;

const globalForAgentChannels = globalThis as typeof globalThis & {
  __lumaAgentChannelWaiters?: ChannelWaitRegistry;
};

const channelWaiters =
  globalForAgentChannels.__lumaAgentChannelWaiters ?? new Map<string, Set<Waiter>>();
globalForAgentChannels.__lumaAgentChannelWaiters = channelWaiters;

export function notifyAgentChannel(channelId: string) {
  const waiters = channelWaiters.get(channelId);
  if (!waiters) return;
  for (const wake of Array.from(waiters)) {
    wake();
  }
}

export function waitForAgentChannelActivity(
  channelId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<"woken" | "timeout" | "aborted"> {
  if (timeoutMs <= 0) return Promise.resolve("timeout");
  if (abortSignal?.aborted) return Promise.resolve("aborted");

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (outcome: "woken" | "timeout" | "aborted") => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      const set = channelWaiters.get(channelId);
      set?.delete(onWake);
      if (set && set.size === 0) channelWaiters.delete(channelId);
      resolve(outcome);
    };

    const onWake = () => finish("woken");
    const onAbort = () => finish("aborted");

    const set = channelWaiters.get(channelId) ?? new Set<Waiter>();
    set.add(onWake);
    channelWaiters.set(channelId, set);

    abortSignal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => finish("timeout"), Math.min(timeoutMs, 2_147_483_647));
  });
}

export function isValidMayflyId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{22}$/u.test(value);
}

export function isValidAuthHash(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

export function hashMayflyBearer(bearer: string): string {
  return createHash("sha256").update(bearer, "utf8").digest("base64url");
}

export function verifyMayflyBearer(bearer: string | null, expectedAuthHash: string): boolean {
  if (!bearer || !/^[A-Za-z0-9_-]{43}$/u.test(bearer)) return false;
  const candidate = Buffer.from(hashMayflyBearer(bearer), "utf8");
  const expected = Buffer.from(expectedAuthHash, "utf8");
  if (candidate.byteLength !== expected.byteLength) return false;
  return timingSafeEqual(candidate, expected);
}

export function parseBase64UrlBytes(value: unknown): Buffer | null {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  if (value.length % 4 === 1) return null;
  return Buffer.from(value, "base64url");
}

export async function sweepExpiredAgentChannels() {
  await ensureChatSchema();
  await db
    .delete(agentChannels)
    .where(sql`${agentChannels.updatedAt} < now() - interval '24 hours'`);
}

export type SerializedChannelEvent = {
  seq: number;
  ts: string;
  src: string;
  nonce: string;
  ct: string;
};

export type ChannelPage = {
  last: number;
  more: boolean;
  events: SerializedChannelEvent[];
};

export async function readChannelPage(
  channelId: string,
  expectedBearer: string | null,
  since: number,
): Promise<
  | { status: 404 }
  | { status: 401 }
  | { status: 200; page: ChannelPage }
> {
  await sweepExpiredAgentChannels();

  const [channel] = await db
    .select({
      id: agentChannels.id,
      authHash: agentChannels.authHash,
      eventCount: agentChannels.eventCount,
    })
    .from(agentChannels)
    .where(eq(agentChannels.id, channelId))
    .limit(1);

  if (!channel) return { status: 404 };
  if (!verifyMayflyBearer(expectedBearer, channel.authHash)) return { status: 401 };

  const head = channel.eventCount - 1;
  if (since >= head) {
    return {
      status: 200,
      page: { last: head, more: false, events: [] },
    };
  }

  const rows = await db
    .select({
      seq: agentChannelEvents.seq,
      ts: agentChannelEvents.ts,
      src: agentChannelEvents.src,
      nonce: agentChannelEvents.nonce,
      ct: agentChannelEvents.ct,
      ctBytes: agentChannelEvents.ctBytes,
    })
    .from(agentChannelEvents)
    .where(and(eq(agentChannelEvents.channelId, channelId), gt(agentChannelEvents.seq, since)))
    .orderBy(asc(agentChannelEvents.seq))
    .limit(MAX_PAGE_EVENTS + 1);

  const selected: SerializedChannelEvent[] = [];
  let byteSum = 0;
  let more = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (i >= MAX_PAGE_EVENTS || (selected.length > 0 && byteSum + row.ctBytes > MAX_PAGE_BYTES)) {
      more = true;
      break;
    }
    byteSum += row.ctBytes;
    selected.push({
      seq: row.seq,
      ts: row.ts.toISOString(),
      src: row.src,
      nonce: row.nonce,
      ct: row.ct,
    });
  }

  const last = selected.length > 0 ? selected[selected.length - 1].seq : head;
  if (!more && last < head) more = true;

  return {
    status: 200,
    page: { last, more, events: selected },
  };
}

export async function appendChannelEvent(params: {
  channelId: string;
  bearer: string | null;
  last: number;
  nonce: string;
  ct: string;
  ctBytes: number;
  src: string;
}): Promise<
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "budget_exceeded" }
  | { kind: "conflict"; page: ChannelPage }
  | { kind: "posted"; id: number }
> {
  await sweepExpiredAgentChannels();

  const outcome = await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select id, auth_hash, bytes_used, event_count
      from agent_channels
      where id = ${params.channelId}
      for update
    `);
    const channel = locked.rows[0] as
      | { id: string; auth_hash: string; bytes_used: number; event_count: number }
      | undefined;

    if (!channel) return { kind: "not_found" as const };
    if (!verifyMayflyBearer(params.bearer, channel.auth_hash)) {
      return { kind: "unauthorized" as const };
    }

    const head = Number(channel.event_count) - 1;
    if (params.last !== head) {
      const rows = await tx
        .select({
          seq: agentChannelEvents.seq,
          ts: agentChannelEvents.ts,
          src: agentChannelEvents.src,
          nonce: agentChannelEvents.nonce,
          ct: agentChannelEvents.ct,
          ctBytes: agentChannelEvents.ctBytes,
        })
        .from(agentChannelEvents)
        .where(
          and(
            eq(agentChannelEvents.channelId, params.channelId),
            gt(agentChannelEvents.seq, params.last),
          ),
        )
        .orderBy(asc(agentChannelEvents.seq))
        .limit(MAX_PAGE_EVENTS + 1);

      const selected: SerializedChannelEvent[] = [];
      let byteSum = 0;
      let more = false;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (i >= MAX_PAGE_EVENTS || (selected.length > 0 && byteSum + row.ctBytes > MAX_PAGE_BYTES)) {
          more = true;
          break;
        }
        byteSum += row.ctBytes;
        selected.push({
          seq: row.seq,
          ts: row.ts.toISOString(),
          src: row.src,
          nonce: row.nonce,
          ct: row.ct,
        });
      }
      const returnedLast = selected.length > 0 ? selected[selected.length - 1].seq : head;
      if (!more && returnedLast < head) more = true;
      return {
        kind: "conflict" as const,
        page: { last: returnedLast, more, events: selected },
      };
    }

    const nextBytes = Number(channel.bytes_used) + params.ctBytes;
    const nextCount = Number(channel.event_count) + 1;
    if (nextCount > MAX_CHANNEL_EVENTS || nextBytes > MAX_CHANNEL_BYTES) {
      return { kind: "budget_exceeded" as const };
    }

    const nextSeq = head + 1;
    const now = new Date();
    await tx.insert(agentChannelEvents).values({
      channelId: params.channelId,
      seq: nextSeq,
      ts: now,
      src: params.src,
      nonce: params.nonce,
      ct: params.ct,
      ctBytes: params.ctBytes,
    });
    await tx
      .update(agentChannels)
      .set({
        bytesUsed: nextBytes,
        eventCount: nextCount,
        updatedAt: now,
      })
      .where(eq(agentChannels.id, params.channelId));

    return { kind: "posted" as const, id: nextSeq };
  });

  if (outcome.kind === "posted") {
    notifyAgentChannel(params.channelId);
  }
  return outcome;
}

export async function deleteAgentChannel(
  channelId: string,
  bearer: string | null,
): Promise<204 | 401 | 404> {
  await sweepExpiredAgentChannels();

  const [channel] = await db
    .select({ id: agentChannels.id, authHash: agentChannels.authHash })
    .from(agentChannels)
    .where(eq(agentChannels.id, channelId))
    .limit(1);

  if (!channel) return 404;
  if (!verifyMayflyBearer(bearer, channel.authHash)) return 401;

  await db.delete(agentChannels).where(eq(agentChannels.id, channelId));
  notifyAgentChannel(channelId);
  return 204;
}
