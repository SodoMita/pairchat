import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  boolean,
  index,
} from "drizzle-orm/pg-core";

/**
 * A user identity. Created on first visit and stored as a cookie.
 * Anonymous - we only track a stable ID and chosen display name.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: varchar("display_name", { length: 32 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Private chat rooms. Created via "Create room" button on the landing page.
 * The owner shares the URL to invite a single stranger.
 */
export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inviteCode: varchar("invite_code", { length: 12 }).notNull().unique(),
    hostUserId: uuid("host_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The other participant's user id. NULL means the host is alone.
     * Combined with a pg_advisory_xact_lock(hashtext(room_id)) on join,
     * this gives us atomic 1:1 seat assignment without needing a separate
     * table. The host sets joined_user_id to NULL on creation; the first
     * guest join writes their id here; subsequent joins see non-null
     * and are rejected with "Room is full".
     */
    joinedUserId: uuid("joined_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("rooms_invite_code_idx").on(t.inviteCode)],
);

/**
 * Matchmaking queue for the stranger chat roulette.
 * Each row is a user currently waiting for a partner.
 * Two users in the queue are paired off (FIFO) and given a shared
 * "sessionId" string. Both sides poll the same session for messages.
 */
export const matchmaking = pgTable(
  "matchmaking",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: varchar("session_id", { length: 36 }),
    /**
     * The user's static X25519 identity public key (base64url, 32 bytes
     * raw → 43 chars). Published by the client once per session and
     * used by the partner to derive the shared symmetric key. The
     * server stores it but cannot decrypt anything with it.
     */
    identityPubKey: varchar("identity_pub_key", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
  },
  (t) => [
    index("matchmaking_session_idx").on(t.sessionId),
    index("matchmaking_unpaired_idx").on(t.pairedAt),
  ],
);

/**
 * Messages for both stranger sessions and private rooms.
 * `scope` is either "stranger:<sessionId>" or "room:<roomId>".
 * SSE subscribers filter on scope to receive new messages.
 *
 * Body is stored as a self-describing JSON envelope:
 *   `{ v: 1, ct: "<base64url ciphertext>", iv: "<base64url iv>" }`
 * The AES-GCM ciphertext already includes a 16-byte authentication tag
 * so any server-side tampering invalidates it on decrypt.
 *
 * The server never holds the encryption key. For stranger chats, both
 * parties publish an X25519 public key through `matchmaking` and derive
 * a shared secret via ECDH. For private rooms, the host generates a
 * random key and shares it via the URL fragment (browser-only).
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: varchar("scope", { length: 80 }).notNull(),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    senderName: varchar("sender_name", { length: 32 }).notNull(),
    body: text("body").notNull(),
    /**
     * Sender's per-message ephemeral X25519 public key (base64url), used
     * only for stranger chats where the shared key is derived from a
     * DH handshake. For rooms the field is empty and the body's
     * envelope identifies itself as a room message.
     */
    senderPubKey: varchar("sender_pub_key", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    systemFlag: boolean("system_flag").notNull().default(false),
  },
  (t) => [index("messages_scope_idx").on(t.scope)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type Matchmaking = typeof matchmaking.$inferSelect;
export type NewMatchmaking = typeof matchmaking.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;