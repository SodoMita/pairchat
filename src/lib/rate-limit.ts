type Bucket = { count: number; resetAt: number };
type Registry = Map<string, Bucket>;

const globalForRateLimit = globalThis as typeof globalThis & {
  __lumaRateLimits?: Registry;
};

const registry = globalForRateLimit.__lumaRateLimits ?? new Map<string, Bucket>();
globalForRateLimit.__lumaRateLimits = registry;

export function allowRequest(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (registry.size > 10_000) {
    for (const [entryKey, bucket] of registry) {
      if (bucket.resetAt <= now) registry.delete(entryKey);
    }
  }
  const current = registry.get(key);
  if (!current || current.resetAt <= now) {
    registry.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}
