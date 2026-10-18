import type { RoomKind, RoomStatus, RoomSnapshot } from "@/lib/chat";

export const LOCAL_CHATS_KEY = "luma-local-chats-v1";
export const LOCAL_ABUSE_SESSION_KEY = "luma-abuse-session-v1";
export const MAX_LOCAL_MESSAGES = 500;

export type LocalChatMessage = {
  id: string;
  body: string;
  senderPublicId?: string;
  /** Legacy local-only transcript field; never sent over the network. */
  senderClientId?: string;
  createdAt: string;
  delivery?: "sent" | "delivered";
};

type SigningMaterial = {
  signingPrivateKey: JsonWebKey;
  signingPublicKey: JsonWebKey;
};

export type ConversationEncryption =
  | ({ mode: "private"; secret: string } & Partial<SigningMaterial>)
  | ({ mode: "ecdh"; privateKey: JsonWebKey; publicKey: JsonWebKey } & Partial<SigningMaterial>);

export type LocalConversation = {
  roomId: string;
  clientId: string;
  publicId?: string;
  kind: RoomKind;
  status: RoomStatus;
  createdAt: string;
  updatedAt: string;
  encryption?: ConversationEncryption;
  rememberRandomHistory?: boolean;
  messages: LocalChatMessage[];
};

function isMessage(value: unknown): value is LocalChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<LocalChatMessage>;
  return (
    typeof message.id === "string" &&
    typeof message.body === "string" &&
    (typeof message.senderPublicId === "string" ||
      typeof message.senderClientId === "string") &&
    typeof message.createdAt === "string" &&
    (message.delivery === undefined ||
      message.delivery === "sent" ||
      message.delivery === "delivered")
  );
}

function isEncryption(value: unknown): value is ConversationEncryption {
  if (!value || typeof value !== "object") return false;
  const encryption = value as Partial<ConversationEncryption>;
  const hasSigningPrivate = encryption.signingPrivateKey !== undefined;
  const hasSigningPublic = encryption.signingPublicKey !== undefined;
  const signingValid =
    hasSigningPrivate === hasSigningPublic &&
    (!hasSigningPrivate ||
      (typeof encryption.signingPrivateKey === "object" &&
        encryption.signingPrivateKey !== null &&
        typeof encryption.signingPublicKey === "object" &&
        encryption.signingPublicKey !== null));
  if (!signingValid) return false;
  if (encryption.mode === "private") {
    return typeof encryption.secret === "string";
  }
  if (encryption.mode === "ecdh") {
    return (
      typeof encryption.privateKey === "object" &&
      encryption.privateKey !== null &&
      typeof encryption.publicKey === "object" &&
      encryption.publicKey !== null
    );
  }
  return false;
}

function isConversation(value: unknown): value is LocalConversation {
  if (!value || typeof value !== "object") return false;
  const conversation = value as Partial<LocalConversation>;
  return (
    typeof conversation.roomId === "string" &&
    typeof conversation.clientId === "string" &&
    (conversation.publicId === undefined || typeof conversation.publicId === "string") &&
    (conversation.kind === "random" || conversation.kind === "private") &&
    (conversation.status === "waiting" ||
      conversation.status === "active" ||
      conversation.status === "ended") &&
    typeof conversation.createdAt === "string" &&
    typeof conversation.updatedAt === "string" &&
    (conversation.encryption === undefined || isEncryption(conversation.encryption)) &&
    (conversation.rememberRandomHistory === undefined ||
      typeof conversation.rememberRandomHistory === "boolean") &&
    Array.isArray(conversation.messages) &&
    conversation.messages.every(isMessage)
  );
}

export function loadLocalConversations(): LocalConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_CHATS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isConversation)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

function writeLocalConversations(conversations: LocalConversation[]) {
  const sorted = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  window.localStorage.setItem(LOCAL_CHATS_KEY, JSON.stringify(sorted));
  return sorted;
}

export function saveLocalRoom(
  room: RoomSnapshot,
  clientId: string,
  encryption?: ConversationEncryption,
): LocalConversation[] {
  const current = loadLocalConversations();
  const existing = current.find((item) => item.roomId === room.id);
  const forgetRandomHistory =
    room.kind === "random" &&
    room.status === "ended" &&
    !existing?.rememberRandomHistory;
  const next: LocalConversation = {
    roomId: room.id,
    clientId,
    publicId: room.participantPublicId || existing?.publicId,
    kind: room.kind,
    status: room.status,
    createdAt: existing?.createdAt ?? room.createdAt,
    updatedAt:
      existing && existing.status === room.status
        ? existing.updatedAt
        : new Date().toISOString(),
    encryption:
      room.status === "ended"
        ? undefined
        : encryption ?? existing?.encryption,
    rememberRandomHistory: existing?.rememberRandomHistory ?? false,
    messages: forgetRandomHistory ? [] : existing?.messages ?? [],
  };
  return writeLocalConversations([
    next,
    ...current.filter((item) => item.roomId !== room.id),
  ]);
}

export function setLocalRandomHistoryPreference(
  roomId: string,
  rememberRandomHistory: boolean,
): LocalConversation[] {
  const current = loadLocalConversations();
  return writeLocalConversations(
    current.map((conversation) =>
      conversation.roomId === roomId
        ? { ...conversation, rememberRandomHistory }
        : conversation,
    ),
  );
}

export function deleteLocalConversation(roomId: string): LocalConversation[] {
  return writeLocalConversations(
    loadLocalConversations().filter((conversation) => conversation.roomId !== roomId),
  );
}

export function markLocalMessageDelivered(
  roomId: string,
  messageId: string,
): LocalConversation[] {
  const current = loadLocalConversations();
  return writeLocalConversations(
    current.map((conversation) =>
      conversation.roomId !== roomId
        ? conversation
        : {
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id === messageId
                ? { ...message, delivery: "delivered" as const }
                : message,
            ),
          },
    ),
  );
}

export function saveLocalEncryption(
  roomId: string,
  encryption: ConversationEncryption,
): LocalConversation[] {
  const current = loadLocalConversations();
  return writeLocalConversations(
    current.map((conversation) =>
      conversation.roomId === roomId
        ? { ...conversation, encryption }
        : conversation,
    ),
  );
}

export function saveLocalMessage(
  roomId: string,
  message: LocalChatMessage,
): LocalConversation[] {
  const current = loadLocalConversations();
  const next = current.map((conversation) => {
    if (conversation.roomId !== roomId) return conversation;
    if (conversation.messages.some((item) => item.id === message.id)) return conversation;
    return {
      ...conversation,
      updatedAt: message.createdAt,
      messages: [...conversation.messages, message]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-MAX_LOCAL_MESSAGES),
    };
  });
  return writeLocalConversations(next);
}

export function setLocalRoomStatus(
  roomId: string,
  status: RoomStatus,
): LocalConversation[] {
  const current = loadLocalConversations();
  return writeLocalConversations(
    current.map((conversation) =>
      conversation.roomId === roomId
        ? {
            ...conversation,
            status,
            encryption: status === "ended" ? undefined : conversation.encryption,
            messages:
              status === "ended" &&
              conversation.kind === "random" &&
              !conversation.rememberRandomHistory
                ? []
                : conversation.messages,
            updatedAt: new Date().toISOString(),
          }
        : conversation,
    ),
  );
}

export function createParticipantId() {
  return `guest_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function getOrCreateAbuseSession() {
  if (typeof window === "undefined") return "";
  try {
    const existing = JSON.parse(
      window.localStorage.getItem(LOCAL_ABUSE_SESSION_KEY) ?? "null",
    ) as { token?: string; expiresAt?: number } | null;
    if (
      existing &&
      typeof existing.token === "string" &&
      /^as_[A-Za-z0-9_-]{43}$/u.test(existing.token) &&
      typeof existing.expiresAt === "number" &&
      existing.expiresAt > Date.now()
    ) {
      return existing.token;
    }
  } catch {
    // Replace malformed storage with a fresh opaque session below.
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = `as_${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")}`;
  window.localStorage.setItem(
    LOCAL_ABUSE_SESSION_KEY,
    JSON.stringify({ token, expiresAt: Date.now() + 24 * 60 * 60_000 }),
  );
  return token;
}
