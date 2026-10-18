import { pgTable, text, timestamp, uuid, varchar, boolean, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: varchar("display_name", { length: 32 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Only the SHA-256 digest of a random 256-bit bearer token is persisted.
// Public user ids are NOT authentication credentials.
export const sessions = pgTable("sessions", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("sessions_expiry_idx").on(t.expiresAt)]);

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  inviteCode: varchar("invite_code", { length: 12 }).notNull().unique(),
  hostUserId: uuid("host_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedUserId: uuid("joined_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  // Versioned salted scrypt verifier; legacy SHA-256 is upgraded on successful entry.
  passphraseHash: text("passphrase_hash"),
  // Hash of a domain-separated random-key-derived admission capability.
  // Neither the encryption key nor the capability is stored here.
  joinTokenHash: varchar("join_token_hash", { length: 64 }),
}, (t) => [index("rooms_invite_code_idx").on(t.inviteCode)]);

// All queue mutations use the same PostgreSQL transaction advisory lock.
export const matchmaking = pgTable("matchmaking", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: varchar("session_id", { length: 36 }),
  identityPubKey: varchar("identity_pub_key", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  pairedAt: timestamp("paired_at", { withTimezone: true }),
}, (t) => [index("matchmaking_session_idx").on(t.sessionId), index("matchmaking_unpaired_idx").on(t.pairedAt)]);

// Legacy archive only. New message routes NEVER read or write this table.
// Retained in the schema to avoid silently destroying existing deployments'
// data during an upgrade. See docs/security-review.md for explicit purging.
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: varchar("scope", { length: 80 }).notNull(),
  senderUserId: uuid("sender_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  senderName: varchar("sender_name", { length: 32 }).notNull(),
  body: text("body").notNull(),
  senderPubKey: varchar("sender_pub_key", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  systemFlag: boolean("system_flag").notNull().default(false),
}, (t) => [index("messages_scope_idx").on(t.scope)]);

export type User = typeof users.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type Message = typeof messages.$inferSelect;
