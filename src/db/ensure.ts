import type { Pool } from "pg";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chat_rooms (
  id text PRIMARY KEY,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'waiting',
  key_commitment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS chat_rooms_kind_status_idx ON chat_rooms (kind, status);
CREATE INDEX IF NOT EXISTS chat_rooms_updated_at_idx ON chat_rooms (updated_at);

CREATE TABLE IF NOT EXISTS chat_participants (
  id serial PRIMARY KEY,
  room_id text NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  seat integer NOT NULL,
  public_key text,
  signing_key text,
  abuse_session_hash text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_participants_room_client_idx ON chat_participants (room_id, client_id);
CREATE UNIQUE INDEX IF NOT EXISTS chat_participants_room_public_id_idx ON chat_participants (room_id, public_id);
CREATE UNIQUE INDEX IF NOT EXISTS chat_participants_room_seat_idx ON chat_participants (room_id, seat);
CREATE INDEX IF NOT EXISTS chat_participants_client_idx ON chat_participants (client_id);
CREATE INDEX IF NOT EXISTS chat_participants_abuse_session_idx ON chat_participants (abuse_session_hash);

CREATE TABLE IF NOT EXISTS chat_reports (
  id serial PRIMARY KEY,
  room_id text NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  reporter_access_hash text NOT NULL,
  target_public_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_reports_once_per_target_idx
  ON chat_reports (room_id, reporter_access_hash, target_public_id);
CREATE INDEX IF NOT EXISTS chat_reports_reporter_idx
  ON chat_reports (reporter_access_hash, created_at);

CREATE TABLE IF NOT EXISTS abuse_signals (
  session_hash text PRIMARY KEY,
  score integer NOT NULL DEFAULT 0,
  cooldown_until timestamptz,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abuse_signals_expires_idx ON abuse_signals (expires_at);
`;

let ready: Promise<void> | null = null;

export function ensureSchema(pool: Pool) {
  ready ??= pool.query(SCHEMA_SQL).then(() => undefined).catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}
