export type EncryptedMessageEnvelope = {
  version: 1;
  id: string;
  iv: string;
  ciphertext: string;
  signature: string;
  senderPublicId: string;
  createdAt: string;
};

export type LiveChatEvent =
  | { type: "message"; message: EncryptedMessageEnvelope }
  | { type: "peer"; connected: boolean }
  | { type: "typing"; senderPublicId: string; active: boolean };

type ChatEventListener = (event: LiveChatEvent) => void;
type ParticipantListeners = Map<string, Set<ChatEventListener>>;
type ChatEventRegistry = Map<string, ParticipantListeners>;

const globalForChatEvents = globalThis as typeof globalThis & {
  __lumaChatEventRegistry?: ChatEventRegistry;
};

const registry =
  globalForChatEvents.__lumaChatEventRegistry ??
  new Map<string, ParticipantListeners>();

globalForChatEvents.__lumaChatEventRegistry = registry;

function notifyPeerState(roomId: string) {
  const participants = registry.get(roomId);
  if (!participants) return;
  const connected = participants.size >= 2;
  for (const listeners of participants.values()) {
    for (const listener of listeners) listener({ type: "peer", connected });
  }
}

export function publishTypingState(
  roomId: string,
  senderAccessHash: string,
  senderPublicId: string,
  active: boolean,
) {
  const participants = registry.get(roomId);
  if (!participants) return false;
  let delivered = false;
  for (const [accessHash, listeners] of participants) {
    if (accessHash === senderAccessHash) continue;
    delivered = true;
    for (const listener of listeners) {
      listener({ type: "typing", senderPublicId, active });
    }
  }
  return delivered;
}

export function publishChatMessage(
  roomId: string,
  senderClientId: string,
  message: EncryptedMessageEnvelope,
) {
  const participants = registry.get(roomId);
  const hasPeer = participants
    ? Array.from(participants.keys()).some((clientId) => clientId !== senderClientId)
    : false;
  if (!participants || !hasPeer) return false;
  for (const listeners of participants.values()) {
    for (const listener of listeners) listener({ type: "message", message });
  }
  return true;
}

export function subscribeToChatMessages(
  roomId: string,
  clientId: string,
  listener: ChatEventListener,
) {
  const participants = registry.get(roomId) ?? new Map<string, Set<ChatEventListener>>();
  const listeners = participants.get(clientId) ?? new Set<ChatEventListener>();
  listeners.add(listener);
  participants.set(clientId, listeners);
  registry.set(roomId, participants);
  notifyPeerState(roomId);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) participants.delete(clientId);
    if (participants.size === 0) registry.delete(roomId);
    else notifyPeerState(roomId);
  };
}
