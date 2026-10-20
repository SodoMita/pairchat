import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Provision an empty preview database before serving chat requests. Schema
 * evolution still belongs to `npx drizzle-kit push`; this bootstrap only
 * creates the current schema if it is missing. All DDL uses Drizzle.
 */
let schemaReady: Promise<void> | undefined;

async function createChatSchema() {
  await db.transaction(async (tx) => {
    // Different route bundles/processes can receive their first requests at
    // once. A transaction-scoped lock serializes the idempotent DDL.
    await tx.execute(sql`select pg_advisory_xact_lock(7402180)`);
    await tx.execute(sql`
      create table if not exists chat_rooms (
        id text primary key,
        kind text not null,
        status text not null default 'waiting',
        key_commitment text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        ended_at timestamptz
      )
    `);
    await tx.execute(sql`
      create table if not exists chat_participants (
        id serial primary key,
        room_id text not null references chat_rooms(id) on delete cascade,
        client_id text not null,
        public_id uuid not null default gen_random_uuid(),
        seat integer not null,
        public_key text,
        signing_key text,
        abuse_session_hash text,
        joined_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now(),
        left_at timestamptz
      )
    `);
    await tx.execute(sql`
      create table if not exists chat_reports (
        id serial primary key,
        room_id text not null references chat_rooms(id) on delete cascade,
        reporter_access_hash text not null,
        target_public_id uuid not null,
        reason text not null,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null
      )
    `);
    await tx.execute(sql`
      create table if not exists abuse_signals (
        session_hash text primary key,
        score integer not null default 0,
        cooldown_until timestamptz,
        expires_at timestamptz not null,
        updated_at timestamptz not null default now()
      )
    `);
    await tx.execute(sql`create index if not exists chat_rooms_kind_status_idx on chat_rooms (kind, status)`);
    await tx.execute(sql`create index if not exists chat_rooms_updated_at_idx on chat_rooms (updated_at)`);
    await tx.execute(sql`create unique index if not exists chat_participants_room_client_idx on chat_participants (room_id, client_id)`);
    await tx.execute(sql`create unique index if not exists chat_participants_room_public_id_idx on chat_participants (room_id, public_id)`);
    await tx.execute(sql`create unique index if not exists chat_participants_room_seat_idx on chat_participants (room_id, seat)`);
    await tx.execute(sql`create index if not exists chat_participants_client_idx on chat_participants (client_id)`);
    await tx.execute(sql`create index if not exists chat_participants_abuse_session_idx on chat_participants (abuse_session_hash)`);
    await tx.execute(sql`create unique index if not exists chat_reports_once_per_target_idx on chat_reports (room_id, reporter_access_hash, target_public_id)`);
    await tx.execute(sql`create index if not exists chat_reports_reporter_idx on chat_reports (reporter_access_hash, created_at)`);
    await tx.execute(sql`create index if not exists abuse_signals_expires_idx on abuse_signals (expires_at)`);
    await tx.execute(sql`
      create table if not exists agent_channels (
        id text primary key,
        auth_hash text not null,
        bytes_used integer not null default 0,
        event_count integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await tx.execute(sql`
      create table if not exists agent_channel_events (
        id serial primary key,
        channel_id text not null references agent_channels(id) on delete cascade,
        seq integer not null,
        ts timestamptz not null default now(),
        src text not null,
        nonce text not null,
        ct text not null,
        ct_bytes integer not null
      )
    `);
    await tx.execute(sql`create index if not exists agent_channels_updated_at_idx on agent_channels (updated_at)`);
    await tx.execute(sql`create unique index if not exists agent_channel_events_channel_seq_idx on agent_channel_events (channel_id, seq)`);
    // Earlier releases stored raw bearer credentials. Migrate them under the
    // same advisory lock before any API reports readiness; PostgreSQL's core
    // SHA-256 needs no extension or privileged CREATE EXTENSION command.
    await tx.execute(sql`
      update chat_participants
      set client_id = encode(sha256(convert_to(client_id, 'UTF8')), 'hex')
      where client_id !~ '^[a-f0-9]{64}$'
    `);
    // SELECT 1 can be healthy even if the chat schema is unusable.
    await tx.execute(sql`select public_id, signing_key, abuse_session_hash from chat_participants limit 0`);
  });
}

export function ensureChatSchema(): Promise<void> {
  schemaReady ??= createChatSchema().catch((error: unknown) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}
