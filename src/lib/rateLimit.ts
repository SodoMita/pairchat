import "server-only";

/**
 * Tiny in-process token-bucket rate limiter. Resets on server restart,
 * which is fine for a single-instance deployment. Multi-instance would
 * need Redis or similar.
 *
 * Keys are arbitrary strings; in practice we use `<route>:<ip>` or
 * `<route>:<userId>`. Each key has an independent bucket.
 *
 * Stale entries (fully refilled and unused for 10 minutes) are swept
 * periodically so the Map doesn't grow without bound.
 */

type Bucket = {
  tokens: number;
  updatedAt: number;
};

const buckets = new Map<string, Bucket>();

const DEFAULT_CAPACITY = 30;
const DEFAULT_REFILL_PER_SEC = 1;

// Sweep stale entries every 5 minutes.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_MS = 10 * 60 * 1000;
let lastSweepAt = Date.now();

export type RateResult = { ok: true } | { ok: false; retryAfterMs: number };

function maybeSweep(now: number) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.updatedAt > STALE_THRESHOLD_MS) {
      buckets.delete(key);
    }
  }
}

/**
 * Refill tokens proportional to elapsed time, then try to consume 1.
 * Returns ok=false when the bucket is empty.
 */
export function consume(
  key: string,
  capacity = DEFAULT_CAPACITY,
  refillPerSec = DEFAULT_REFILL_PER_SEC,
): RateResult {
  const now = Date.now();
  maybeSweep(now);
  const b = buckets.get(key);
  const tokens = b
    ? Math.min(
        capacity,
        b.tokens + ((now - b.updatedAt) / 1000) * refillPerSec,
      )
    : capacity;
  if (tokens < 1) {
    const deficit = 1 - tokens;
    const retryAfterMs = Math.ceil((deficit / refillPerSec) * 1000);
    buckets.set(key, { tokens, updatedAt: now });
    return { ok: false, retryAfterMs };
  }
  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return { ok: true };
}

/**
 * Test/diagnostic: peek at the current bucket size.
 */
export function inspect(key: string): number {
  return buckets.get(key)?.tokens ?? DEFAULT_CAPACITY;
}