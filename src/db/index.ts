import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);

let credentialMigration: Promise<void> | null = null;

/** Hash pre-deploy raw bearer credentials in place so old rooms stay reachable. */
export function migrateStoredCredentials() {
  credentialMigration ??= (async () => {
    try {
      await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    } catch {
      // Parallel workers can race on the extension catalog; the extension is still usable.
    }
    await pool.query(`
      UPDATE chat_participants
      SET client_id = encode(digest(convert_to(client_id, 'UTF8'), 'sha256'), 'hex')
      WHERE client_id !~ '^[a-f0-9]{64}$'
    `);
  })().catch((error: unknown) => {
    credentialMigration = null;
    console.error("credential migration skipped", error);
  });
  return credentialMigration;
}

void migrateStoredCredentials();
