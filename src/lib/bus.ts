import "server-only";
type Listener = { userId: string; send: (payload: string) => boolean | void };
const globals = globalThis as typeof globalThis & { __cbChannels?: Map<string, Set<Listener>> };
const channels = globals.__cbChannels ??= new Map<string, Set<Listener>>();

// Metadata + live delivery only; this map stores NO message history.
export function subscribe(scope: string, send: Listener["send"], userId = "") {
  const listeners = channels.get(scope) ?? new Set<Listener>();
  const listener = { userId, send };
  listeners.add(listener);
  channels.set(scope, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) channels.delete(scope); };
}
export function publish(scope: string, payload: string): number {
  let accepted = 0;
  for (const listener of [...(channels.get(scope) ?? [])]) {
    try { if (listener.send(payload) !== false) accepted++; } catch { /* failed client */ }
  }
  return accepted;
}
export function subscriberCount(scope: string, exceptUser?: string): number {
  return [...(channels.get(scope) ?? [])].filter(l => !exceptUser || l.userId !== exceptUser).length;
}
