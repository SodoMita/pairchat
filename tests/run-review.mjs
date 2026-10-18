// Run with: node --import tsx tests/run-review.mjs
// Builds are separate: run npm run build first. No production table is reset.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.ts';

const original = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(original.hostname)) throw new Error('Test harness only provisions local PostgreSQL');
const name = `cb_review_${Date.now().toString(36)}_test`;
const target = new URL(original); target.pathname = '/' + name;
const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATABASE_URL: target.href, BASE: base, APP_ORIGIN: base, NEXT_TELEMETRY_DISABLED: '1', REVIEW_ISOLATED: '1' };
let server;
const log = createWriteStream('/tmp/chatterbox-review-server.log', { flags: 'w' });
async function run(command, args) {
  const child = spawn(command, args, { env, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} failed (${code})`);
}
async function start() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env: { ...env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  for (let n = 0; n < 120; n++) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* booting */ }
    if (server.exitCode !== null) throw new Error('Test server exited; see /tmp/chatterbox-review-server.log');
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Test server did not become ready');
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  const timer = setTimeout(() => server?.kill('SIGKILL'), 5000);
  await once(server, 'exit'); clearTimeout(timer);
}
let failed = false;
try {
  await db.execute(sql.raw(`CREATE DATABASE "${name}"`));
  await run('npx', ['drizzle-kit', 'push', '--force']);
  await run(process.execPath, ['--import', 'tsx', '--conditions=react-server', '--test', 'tests/security.test.ts']);
  await start();
  await run(process.execPath, ['--import', 'tsx', 'tests/e2e-api.mjs']);
  // A legitimate opaque session must survive a real Node process restart.
  const before = await fetch(base + '/api/me');
  const cookie = before.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const identity = (await before.json()).user.id;
  await stop(); await start();
  const after = await fetch(base + '/api/me', { headers: { cookie } });
  if ((await after.json()).user.id !== identity) throw new Error('Session lost on restart');
  console.log('PASS: opaque session survives process restart');
  await run(process.execPath, ['tests/browser.mjs']);
} catch (e) { failed = true; console.error(e.message); }
finally {
  await stop(); log.end();
  await db.execute(sql.raw(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
  await pool.end();
}
if (failed) process.exitCode = 1;
else console.log('PASS: complete isolated security/API/browser suite');
