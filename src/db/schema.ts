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
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("chat_participants_room_client_idx").on(table.roomId, table.clientId),
    uniqueIndex("chat_participants_room_public_id_idx").on(table.roomId, table.publicId),
    uniqueIndex("chat_participants_room_seat_idx").on(table.roomId, table.seat),
    index("chat_participants_client_idx").on(table.clientId),
  ],
);

export type ChatRoom = typeof chatRooms.$inferSelect;
