import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const chatRooms = pgTable(
  "chat_rooms",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("waiting"),
    keyCommitment: text("key_commitment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("chat_rooms_kind_status_idx").on(table.kind, table.status),
    index("chat_rooms_updated_at_idx").on(table.updatedAt),
  ],
);

export const chatParticipants = pgTable(
  "chat_participants",
  {
    id: serial("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    publicId: uuid("public_id").notNull().defaultRandom(),
    seat: integer("seat").notNull(),
    publicKey: text("public_key"),
    signingKey: text("signing_key"),
    abuseSessionHash: text("abuse_session_hash"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("chat_participants_room_client_idx").on(table.roomId, table.clientId),
    uniqueIndex("chat_participants_room_public_id_idx").on(table.roomId, table.publicId),
    uniqueIndex("chat_participants_room_seat_idx").on(table.roomId, table.seat),
    index("chat_participants_client_idx").on(table.clientId),
    index("chat_participants_abuse_session_idx").on(table.abuseSessionHash),
  ],
);

export const chatReports = pgTable(
  "chat_reports",
  {
    id: serial("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    reporterAccessHash: text("reporter_access_hash").notNull(),
    targetPublicId: uuid("target_public_id").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("chat_reports_once_per_target_idx").on(
      table.roomId,
      table.reporterAccessHash,
      table.targetPublicId,
    ),
    index("chat_reports_reporter_idx").on(table.reporterAccessHash, table.createdAt),
  ],
);

export const abuseSignals = pgTable(
  "abuse_signals",
  {
    sessionHash: text("session_hash").primaryKey(),
    score: integer("score").notNull().default(0),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("abuse_signals_expires_idx").on(table.expiresAt)],
);

export const agentChannels = pgTable(
  "agent_channels",
  {
    id: text("id").primaryKey(),
    authHash: text("auth_hash").notNull(),
    bytesUsed: integer("bytes_used").notNull().default(0),
    eventCount: integer("event_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agent_channels_updated_at_idx").on(table.updatedAt)],
);

export const agentChannelEvents = pgTable(
  "agent_channel_events",
  {
    id: serial("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => agentChannels.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    src: text("src").notNull(),
    nonce: text("nonce").notNull(),
    ct: text("ct").notNull(),
    ctBytes: integer("ct_bytes").notNull(),
  },
  (table) => [
    uniqueIndex("agent_channel_events_channel_seq_idx").on(table.channelId, table.seq),
  ],
);

export type ChatRoom = typeof chatRooms.$inferSelect;
export type AgentChannel = typeof agentChannels.$inferSelect;
