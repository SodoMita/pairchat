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
  | { type: "typing"; senderPublicId: string; active: boolean }
  | { type: "ended" }
  | {
      type: "ack";
      messageId: string;
      recipientPublicId: string;
      receivedAt: string;
      signature: string;
    };

type PendingDelivery = { senderAccessHash: string; recipientAccessHash: string; expiresAt: number };
type PendingDeliveries = Map<string, Map<string, PendingDelivery>>;

const globalForPendingDelivery = globalThis as typeof globalThis & {
  __lumaPendingDeliveries?: PendingDeliveries;
};
const pendingDeliveries =
  globalForPendingDelivery.__lumaPendingDeliveries ?? new Map<string, Map<string, PendingDelivery>>();
globalForPendingDelivery.__lumaPendingDeliveries = pendingDeliveries;

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
  const recipientAccessHash = Array.from(participants.keys()).find(
    (clientId) => clientId !== senderClientId,
  );
  if (!recipientAccessHash) return false;
  const roomPending = pendingDeliveries.get(roomId) ?? new Map<string, PendingDelivery>();
  const now = Date.now();
  for (const [id, pending] of roomPending) {
    if (pending.expiresAt <= now) roomPending.delete(id);
  }
  roomPending.set(message.id, {
    senderAccessHash: senderClientId,
    recipientAccessHash,
    expiresAt: now + 10 * 60_000,
  });
  pendingDeliveries.set(roomId, roomPending);
  for (const listeners of participants.values()) {
    for (const listener of listeners) listener({ type: "message", message });
  }
  return true;
}

export function acknowledgeChatMessage(
  roomId: string,
  messageId: string,
  recipientAccessHash: string,
  recipientPublicId: string,
  receivedAt: string,
  signature: string,
) {
  const roomPending = pendingDeliveries.get(roomId);
  const pending = roomPending?.get(messageId);
  if (!roomPending || !pending || pending.expiresAt <= Date.now()) return false;
  if (pending.recipientAccessHash !== recipientAccessHash) return false;
  roomPending.delete(messageId);
  if (roomPending.size === 0) pendingDeliveries.delete(roomId);

  const participants = registry.get(roomId);
  const senderListeners = participants?.get(pending.senderAccessHash);
  if (!senderListeners?.size) return false;
  for (const listener of senderListeners) {
    listener({ type: "ack", messageId, recipientPublicId, receivedAt, signature });
  }
  return true;
}

export function countParticipantStreams(roomId: string, clientId: string) {
  return registry.get(roomId)?.get(clientId)?.size ?? 0;
}

/**
 * Tell every connected participant that the room was closed elsewhere, so the
 * partner does not keep a composer open until the next slow status poll.
 */
export function notifyRoomEnded(roomId: string) {
  const participants = registry.get(roomId);
  if (!participants) return;
  for (const listeners of participants.values()) {
    for (const listener of listeners) listener({ type: "ended" });
  }
}

/**
 * Relay an ephemeral typing signal to the other participant only. Typing state
 * is never stored and never leaves this process, matching the "text only,
 * server-blind content" design.
 */
export function publishTypingState(
  roomId: string,
  senderAccessHash: string,
  senderPublicId: string,
  active: boolean,
) {
  const participants = registry.get(roomId);
  if (!participants) return false;
  let delivered = false;
  for (const [clientId, listeners] of participants) {
    if (clientId === senderAccessHash) continue;
    for (const listener of listeners) {
      listener({ type: "typing", senderPublicId, active });
      delivered = true;
    }
  }
  return delivered;
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
