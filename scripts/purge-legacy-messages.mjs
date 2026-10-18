// Explicit administrator operation; never run automatically by tests/builds.
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.ts';
import { messages } from '../src/db/schema.ts';
try {
  const [row] = await db.select({ count: sql`count(*)::int` }).from(messages);
  console.log(`Legacy server message rows: ${row.count}`);
  if (!process.argv.includes('--confirm-server-history-deletion')) {
    console.log('Dry run. To irreversibly remove this server archive, pass --confirm-server-history-deletion. Backups are unaffected.');
  } else {
    await db.delete(messages);
    console.log('Legacy server message rows deleted. New messages are live-relayed, not persisted.');
  }
} finally { await pool.end(); }
