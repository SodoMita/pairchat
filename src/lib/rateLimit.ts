import "server-only";

type Bucket = { tokens: number; updatedAt: number; capacity: number; refill: number };
const globalState = globalThis as typeof globalThis & { __cbRateBuckets?: Map<string, Bucket> };
const buckets = globalState.__cbRateBuckets ??= new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
let lastSweep = 0;
export type RateResult = { ok: true } | { ok: false; retryAfterMs: number };

export function consume(key: string, capacity = 30, refill = 1): RateResult {
  if (!(capacity > 0 && refill > 0)) throw new Error("Invalid rate limit");
  const now = Date.now();
  if (now - lastSweep > 60_000 || buckets.size >= MAX_BUCKETS) {
    lastSweep = now;
    for (const [k, b] of buckets) {
      // Only remove fully refilled buckets; slow quotas must not reset early.
      if (now - b.updatedAt > Math.max(600_000, b.capacity / b.refill * 1000)) buckets.delete(k);
    }
  }
  const b = buckets.get(key);
  if (!b && buckets.size >= MAX_BUCKETS) return { ok: false, retryAfterMs: 60_000 };
  const tokens = b ? Math.min(capacity, b.tokens + Math.max(0, now - b.updatedAt) / 1000 * refill) : capacity;
  buckets.set(key, { tokens: Math.max(0, tokens - (tokens >= 1 ? 1 : 0)), updatedAt: now, capacity, refill });
  return tokens >= 1 ? { ok: true } : { ok: false, retryAfterMs: Math.ceil((1 - tokens) / refill * 1000) };
}
