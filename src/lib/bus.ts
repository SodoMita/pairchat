import "server-only";

/**
 * Tiny in-process pub/sub used by the SSE stream to push new messages
 * to subscribed clients without polling the DB. Each scope gets a Set
 * of subscriber resolver callbacks. When a message is published, all
 * callbacks receive the payload and resolve their pending promises.
 *
 * This is intentionally simple and single-process. For multi-instance
 * deployments we'd swap in Redis or similar, but for the sandbox it's
 * perfectly sufficient.
 */

type Subscriber = (payload: string) => void;

const channels = new Map<string, Set<Subscriber>>();

export function subscribe(scope: string, fn: Subscriber): () => void {
  let set = channels.get(scope);
  if (!set) {
    set = new Set();
    channels.set(scope, set);
  }
  set.add(fn);
  return () => {
    const s = channels.get(scope);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) channels.delete(scope);
  };
}

export function publish(scope: string, payload: string): void {
  const set = channels.get(scope);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch {
      // ignore individual subscriber failures
    }
  }
}

export function subscriberCount(scope: string): number {
  return channels.get(scope)?.size ?? 0;
}