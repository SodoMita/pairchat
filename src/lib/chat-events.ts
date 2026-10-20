import type { CanvasEnvelope } from "@/lib/canvas";

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
    }
  | {
      type: "read";
      messageId: string;
      recipientPublicId: string;
      readAt: string;
      signature: string;
    }
  | { type: "canvas"; envelope: CanvasEnvelope };

const TRANSIENT_TTL_MS = 10 * 60_000;
const MAX_QUEUED_EVENTS = 128;
const MAX_ROOM_CANVAS_EVENTS = 256;

type PendingDelivery = {
  senderAccessHash: string;
  recipientAccessHash: string;
  message: EncryptedMessageEnvelope;
  expiresAt: number;
};
type PendingDeliveries = Map<string, Map<string, PendingDelivery>>;
type QueuedEvent = { event: LiveChatEvent; expiresAt: number };
type PendingRecipientEvents = Map<string, Map<string, QueuedEvent[]>>;
type QueuedCanvasEnvelope = { envelope: CanvasEnvelope; expiresAt: number };
type RoomCanvasLogs = Map<string, QueuedCanvasEnvelope[]>;

type ChatEventListener = (event: LiveChatEvent) => void;
type ParticipantListeners = Map<string, Set<ChatEventListener>>;
type ChatEventRegistry = Map<string, ParticipantListeners>;

const globalForChatState = globalThis as typeof globalThis & {
  __lumaPendingDeliveries?: PendingDeliveries;
  __lumaPendingRecipientEvents?: PendingRecipientEvents;
  __lumaRoomCanvasLogs?: RoomCanvasLogs;
  __lumaChatEventRegistry?: ChatEventRegistry;
};

const pendingDeliveries =
  globalForChatState.__lumaPendingDeliveries ??
  new Map<string, Map<string, PendingDelivery>>();
globalForChatState.__lumaPendingDeliveries = pendingDeliveries;

const pendingRecipientEvents =
  globalForChatState.__lumaPendingRecipientEvents ??
  new Map<string, Map<string, QueuedEvent[]>>();
globalForChatState.__lumaPendingRecipientEvents = pendingRecipientEvents;

const roomCanvasLogs =
  globalForChatState.__lumaRoomCanvasLogs ??
  new Map<string, QueuedCanvasEnvelope[]>();
globalForChatState.__lumaRoomCanvasLogs = roomCanvasLogs;

const registry =
  globalForChatState.__lumaChatEventRegistry ??
  new Map<string, ParticipantListeners>();
globalForChatState.__lumaChatEventRegistry = registry;

function enqueueRecipientEvent(
  roomId: string,
  recipientAccessHash: string,
  event: LiveChatEvent,
) {
  const now = Date.now();
  const roomQueues =
    pendingRecipientEvents.get(roomId) ?? new Map<string, QueuedEvent[]>();
  const fresh = (roomQueues.get(recipientAccessHash) ?? []).filter(
    (entry) => entry.expiresAt > now,
  );
  fresh.push({ event, expiresAt: now + TRANSIENT_TTL_MS });
  roomQueues.set(recipientAccessHash, fresh.slice(-MAX_QUEUED_EVENTS));
  pendingRecipientEvents.set(roomId, roomQueues);
}

function sendOrQueue(
  roomId: string,
  recipientAccessHash: string,
  event: LiveChatEvent,
) {
  enqueueRecipientEvent(roomId, recipientAccessHash, event);
  const listeners = registry.get(roomId)?.get(recipientAccessHash);
  if (listeners?.size) {
    for (const listener of listeners) listener(event);
  }
}

function notifyPeerState(roomId: string) {
  const participants = registry.get(roomId);
  if (!participants) return;
  const connected = participants.size >= 2;
  for (const listeners of participants.values()) {
    for (const listener of listeners) listener({ type: "peer", connected });
  }
}

export function notifyRoomJoined(roomId: string) {
  const participants = registry.get(roomId);
  if (!participants) return;
  for (const listeners of participants.values()) {
    for (const listener of listeners) listener({ type: "peer", connected: true });
  }
}

export function publishChatMessage(
  roomId: string,
  senderClientId: string,
  message: EncryptedMessageEnvelope,
  recipientClientId?: string,
) {
  const participants = registry.get(roomId);
  const recipientAccessHash =
    recipientClientId ??
    (participants
      ? Array.from(participants.keys()).find(
          (clientId) => clientId !== senderClientId,
        )
      : undefined);
  if (!recipientAccessHash) return false;

  const roomPending =
    pendingDeliveries.get(roomId) ?? new Map<string, PendingDelivery>();
  const now = Date.now();
  for (const [id, pending] of roomPending) {
    if (pending.expiresAt <= now) roomPending.delete(id);
  }
  roomPending.set(message.id, {
    senderAccessHash: senderClientId,
    recipientAccessHash,
    message,
    expiresAt: now + TRANSIENT_TTL_MS,
  });
  pendingDeliveries.set(roomId, roomPending);

  const event: LiveChatEvent = { type: "message", message };
  const senderListeners = participants?.get(senderClientId);
  if (senderListeners) {
    for (const listener of senderListeners) listener(event);
  }
  const recipientListeners = participants?.get(recipientAccessHash);
  if (recipientListeners?.size) {
    for (const listener of recipientListeners) listener(event);
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

  sendOrQueue(roomId, pending.senderAccessHash, {
    type: "ack",
    messageId,
    recipientPublicId,
    receivedAt,
    signature,
  });
  return true;
}

export function publishReadReceipt(
  roomId: string,
  senderAccessHash: string,
  messageId: string,
  recipientPublicId: string,
  readAt: string,
  signature: string,
  peerAccessHash?: string,
) {
  const event: LiveChatEvent = {
    type: "read",
    messageId,
    recipientPublicId,
    readAt,
    signature,
  };
  const participants = registry.get(roomId);
  let delivered = false;
  if (participants) {
    for (const [clientId, listeners] of participants) {
      if (clientId === senderAccessHash) continue;
      for (const listener of listeners) {
        listener(event);
        delivered = true;
      }
    }
  }
  if (peerAccessHash) {
    enqueueRecipientEvent(roomId, peerAccessHash, event);
    return true;
  }
  return delivered;
}

export function publishCanvasEvent(
  roomId: string,
  senderAccessHash: string,
  envelope: CanvasEnvelope,
) {
  const now = Date.now();
  let entries = (roomCanvasLogs.get(roomId) ?? []).filter(
    (item) => item.expiresAt > now,
  );
  if (envelope.eventType === "disable" || envelope.eventType === "decline") {
    entries = entries.filter(
      (item) => item.envelope.sessionId !== envelope.sessionId,
    );
  }
  entries.push({ envelope, expiresAt: now + TRANSIENT_TTL_MS });
  if (entries.length > MAX_ROOM_CANVAS_EVENTS) {
    const control = entries.filter(
      (item) =>
        item.envelope.eventType === "invite" ||
        item.envelope.eventType === "accept",
    );
    const rest = entries
      .filter(
        (item) =>
          item.envelope.eventType !== "invite" &&
          item.envelope.eventType !== "accept",
      )
      .slice(-(MAX_ROOM_CANVAS_EVENTS - control.length));
    entries = [...control, ...rest];
  }
  roomCanvasLogs.set(roomId, entries);

  const participants = registry.get(roomId);
  if (participants) {
    for (const [clientId, listeners] of participants) {
      if (clientId === senderAccessHash) continue;
      for (const listener of listeners) {
        listener({ type: "canvas", envelope });
      }
    }
  }
  return true;
}

export function countParticipantStreams(roomId: string, clientId: string) {
  return registry.get(roomId)?.get(clientId)?.size ?? 0;
}

/**
 * Tell every connected participant that the room was closed elsewhere, and
 * erase all transient encrypted message/canvas state for the ended room.
 */
export function notifyRoomEnded(roomId: string) {
  pendingDeliveries.delete(roomId);
  pendingRecipientEvents.delete(roomId);
  roomCanvasLogs.delete(roomId);
  const participants = registry.get(roomId);
  if (!participants) return;
  for (const listeners of participants.values()) {
    for (const listener of listeners) listener({ type: "ended" });
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
  const participants =
    registry.get(roomId) ?? new Map<string, Set<ChatEventListener>>();
  const listeners = participants.get(clientId) ?? new Set<ChatEventListener>();
  listeners.add(listener);
  participants.set(clientId, listeners);
  registry.set(roomId, participants);
  notifyPeerState(roomId);

  const now = Date.now();
  const roomPending = pendingDeliveries.get(roomId);
  if (roomPending) {
    for (const [id, pending] of roomPending) {
      if (pending.expiresAt <= now) {
        roomPending.delete(id);
        continue;
      }
      if (pending.recipientAccessHash === clientId) {
        listener({ type: "message", message: pending.message });
      }
    }
    if (roomPending.size === 0) pendingDeliveries.delete(roomId);
  }

  const roomQueues = pendingRecipientEvents.get(roomId);
  const queued = roomQueues?.get(clientId);
  if (roomQueues && queued) {
    roomQueues.delete(clientId);
    if (roomQueues.size === 0) pendingRecipientEvents.delete(roomId);
    for (const item of queued) {
      if (item.expiresAt > now) listener(item.event);
    }
  }

  const canvasEntries = roomCanvasLogs.get(roomId);
  if (canvasEntries?.length) {
    const fresh = canvasEntries.filter((item) => item.expiresAt > now);
    if (fresh.length === 0) {
      roomCanvasLogs.delete(roomId);
    } else {
      roomCanvasLogs.set(roomId, fresh);
      for (const item of fresh) {
        listener({ type: "canvas", envelope: item.envelope });
      }
    }
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) participants.delete(clientId);
    if (participants.size === 0) registry.delete(roomId);
    else notifyPeerState(roomId);
  };
}
