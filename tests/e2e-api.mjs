// Non-destructive API regressions. Run only via tests/run-review.mjs.
import assert from 'node:assert/strict';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.ts';
import { users, sessions, rooms, matchmaking, messages } from '../src/db/schema.ts';
import { deriveConversationKey, deriveRoomKey, encryptMessage, decryptMessage, generateIdentityKeypair, generateRoomKey, roomJoinProof, hashProof, b64uEncode } from '../src/lib/crypto.ts';
if (process.env.REVIEW_ISOLATED !== '1' || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Use isolated test runner');
const BASE = process.env.BASE;
const ids = [];
const openStreams = [];
let checks = 0;
const check = (condition, name) => { assert.ok(condition, name); checks++; console.log('ok', name); };
const delay = ms => new Promise(r => setTimeout(r, ms));
async function client() {
  const jar = new Map();
  async function request(path, method = 'GET', body, extra = {}) {
    const headers = { cookie: [...jar].map(([k,v]) => k+'='+v).join('; '), ...extra };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const index = kv.indexOf('='); jar.set(kv.slice(0,index),kv.slice(index+1)); }
    return res;
  }
  const bootstrap = await request('/api/me');
  check(bootstrap.headers.getSetCookie().some(x => x.includes('roulette_session_v2=') && x.includes('Secure') && x.includes('HttpOnly')), 'secure opaque cookie');
  const me = (await bootstrap.json()).user; ids.push(me.id);
  return { request, me, jar };
}
async function stream(c, path) {
  const abort = new AbortController();
  const res = await fetch(BASE + path, { headers: { cookie: [...c.jar].map(([k,v]) => k+'='+v).join('; ') }, signal: abort.signal });
  const events = [];
  const state = { closed: false };
  if (res.ok) void (async () => {
    try {
      const reader = res.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, {stream:true});
        for (let i; (i=buffer.indexOf('\n\n'))>=0;) {
          const frame = buffer.slice(0,i); buffer=buffer.slice(i+2);
          const event = /^event: (.+)$/m.exec(frame)?.[1], text=/^data: (.+)$/m.exec(frame)?.[1];
          if (event && text) events.push({ event, data: JSON.parse(text) });
        }
      }
    } catch { /* cancelled */ } finally { state.closed = true; }
  })();
  const result = { status: res.status, events, state, close: () => abort.abort(), wait: async predicate => {
    for(let i=0;i<200;i++) { const value=events.find(predicate); if(value)return value; await delay(25); }
    throw new Error('SSE event timeout: '+path);
  } };
  openStreams.push(result); return result;
}
const [canary] = await db.insert(users).values({ displayName: 'Unrelated test canary' }).returning();
try {
  const a = await client(), b = await client(), outsider = await client();
  const aKey = await generateIdentityKeypair(), bKey = await generateIdentityKeypair();
  const unauth = await fetch(BASE + '/api/stranger/events');
  check(unauth.status === 401, 'unauthenticated stream is HTTP 401');
  // Former PID/HMAC cookie exploit must no longer resolve to the victim.
  const oldKey = createHmac('sha256','chatterbox-dev').update('pid-'+process.pid).digest('hex');
  const forged = a.me.id+'.'+createHmac('sha256',oldKey).update(a.me.id).digest('base64url');
  check((await fetch(BASE+'/api/stranger/events',{headers:{cookie:'roulette_uid='+forged}})).status===401, 'legacy forged cookie is rejected');
  check((await a.request('/api/rooms','POST',{}, {origin:'https://evil.example'})).status===403,'cross-origin creation blocked');
  check((await a.request('/api/rooms','POST',null)).status===400,'null JSON returns 400, not 500');
  check((await a.request('/api/rooms','POST',{padding:'x'.repeat(20000)})).status===413,'oversized body rejected');
  check((await a.request('/api/stranger/start','PATCH',{sessionId:'A'.repeat(21),identityPubKey:b64uEncode(aKey.publicKey)})).status===403,'key publication cannot silently enter queue');
  const queueResponse = await a.request('/api/stranger/start','POST');
  assert.equal(queueResponse.status, 200, 'Queue response: '+await queueResponse.text());
  const aEvents=await stream(a,'/api/stranger/events');
  assert.equal(aEvents.status, 200, 'Event stream HTTP status');
  await aEvents.wait(e=>e.event==='state');
  const paired = await (await b.request('/api/stranger/start','POST')).json(); const sid = paired.sessionId, scope='stranger:'+sid;
  check((await aEvents.wait(e=>e.event==='paired')).data.sessionId===sid, 'pairing is pushed');
  for(const [c,k] of [[a,aKey],[b,bKey]]) check((await c.request('/api/stranger/start','PATCH',{sessionId:sid,identityPubKey:b64uEncode(k.publicKey)})).ok,'publish own key');
  check((await a.request('/api/stranger/start','PATCH',{sessionId:sid,identityPubKey:b64uEncode(bKey.publicKey)})).status===409,'bound key cannot be replaced');
  const [ak,bk]=await Promise.all([deriveConversationKey(aKey,bKey.publicKey,scope),deriveConversationKey(bKey,aKey.publicKey,scope)]);
  const msg = await encryptMessage(ak,scope,a.me.id,'private regression text');
  check((await a.request(`/api/stranger/messages/${sid}`,'POST',{envelope:JSON.stringify(msg)})).status===409,'offline peer returns unsent instead of silent loss');
  const aMessages=await stream(a,`/api/stranger/messages/${sid}`), bMessages=await stream(b,`/api/stranger/messages/${sid}`);
  await bMessages.wait(e=>e.event==='ready');
  const extras=[];
  for(let i=0;i<4;i++)extras.push(await stream(a,'/api/stranger/events'));
  check(extras.every(s=>s.status===200),'bounded additional tabs can connect');
  const exhausted=await stream(a,'/api/stranger/events');
  check(exhausted.status===429,'concurrent stream limit enforced');
  exhausted.close(); for(const s of extras)s.close(); await delay(100);
  check((await a.request(`/api/stranger/messages/${sid}`,'POST',{envelope:JSON.stringify(msg)})).status===202,'relay accepts v2 envelope');
  const received=(await bMessages.wait(e=>e.data.message?.id===msg.id)).data.message;
  check(await decryptMessage(bk,received.body,scope,a.me.id)==='private regression text','recipient decrypts actual wire payload');
  check(await decryptMessage(ak,received.body,scope,a.me.id)==='private regression text','sender decrypts identical self echo');
  check((await a.request(`/api/stranger/messages/${sid}`,'POST',{envelope:JSON.stringify(msg)})).status===409,'replay rejected');
  check((await b.request(`/api/stranger/messages/${sid}`,'POST',{envelope:JSON.stringify(msg)})).status===400,'public sender id is not an auth credential');
  check((await outsider.request(`/api/stranger/messages/${sid}`)).status===403,'outsider cannot read stream');
  check((await a.request(`/api/stranger/messages/${sid}`,'POST',{text:'no plaintext'})).status===400,'plaintext rejected');
  check((await db.select().from(messages).where(eq(messages.scope,scope))).length===0,'no server-side message persistence');
  await a.request('/api/stranger/start','DELETE',{sessionId:sid}); await delay(100);
  check(bMessages.state.closed,'ending chat tears down existing message streams');
  check((await b.request(`/api/stranger/messages/${sid}`,'POST',{envelope:JSON.stringify(await encryptMessage(bk,scope,b.me.id,'after end'))})).status===410,'cannot send after partner leaves');
  await b.request('/api/stranger/start','DELETE',{sessionId:sid});

  // No global queue reset: only this fixture's identities are cleaned.
  const peers=await Promise.all(Array.from({length:6},()=>client()));
  const results=await Promise.all(peers.flatMap(c=>[c.request('/api/stranger/start','POST'), c.request('/api/stranger/start','POST')]));
  check(results.every(r=>r.ok),'concurrent idempotent matchmaking calls succeed');
  const queue=await db.select().from(matchmaking).where(inArray(matchmaking.userId,peers.map(c=>c.me.id)));
  check(queue.length===peers.length && new Set(queue.map(x=>x.userId)).size===peers.length,'one queue record per user under concurrency');
  const counts=new Map(); for(const row of queue)counts.set(row.sessionId,(counts.get(row.sessionId)||0)+1);
  check([...counts.values()].every(n=>n===2),'exactly two participants per matched session');
  for(const c of peers)await c.request('/api/stranger/start','DELETE');

  const raw=generateRoomKey(), proof=await roomJoinProof(raw.key), joinTokenHash=await hashProof(proof);
  const roomReply=await a.request('/api/rooms','POST',{joinTokenHash,passphrase:'correct horse 🐴'});
  check(roomReply.status===201,'private room created'); const room=(await roomReply.json()).room;
  const [stored]=await db.select().from(rooms).where(eq(rooms.id,room.id));
  check(stored.passphraseHash.startsWith('scrypt$'),'salted scrypt verifier stored');
  check(stored.joinTokenHash===joinTokenHash && stored.joinTokenHash!==proof,'only capability hash stored');
  check((await outsider.request(`/api/rooms/${room.id}/enter`,'POST')).status===403,'UUID alone cannot steal private seat');
  check((await b.request(`/api/rooms/${room.id}/enter`,'POST',{proof})).status===401,'passphrase needed');
  check((await b.request(`/api/rooms/${room.id}/enter`,'POST',{proof,passphrase:'wrong'})).status===401,'wrong passphrase rejected');
  check((await b.request(`/api/rooms/${room.id}/enter`,'POST',{proof,passphrase:'correct horse 🐴'})).ok,'correct proof and passphrase enter');
  check((await b.request(`/api/rooms/${room.id}/enter`,'POST')).ok,'authenticated guest resumes without repeated passphrase');
  check((await outsider.request(`/api/rooms/${room.id}/join`,'POST',{proof,passphrase:'correct horse 🐴'})).status===409,'third seat blocked');
  check((await outsider.request(`/api/rooms/${room.id}/messages`)).status===403,'room read authorized');
  const otherKey=generateRoomKey(); const other=await a.request('/api/rooms','POST',{joinTokenHash:await hashProof(await roomJoinProof(otherKey.key))});
  check(other.ok,'second private chat can coexist');
  check((await a.request(`/api/rooms/${room.id}`)).ok,'creating another room does not close first');
  const bs=await stream(b,`/api/rooms/${room.id}/messages`); await bs.wait(e=>e.event==='ready');
  const rscope='room:'+room.id, rkey=await deriveRoomKey(raw.key,rscope);
  const env=await encryptMessage(rkey,rscope,a.me.id,'private room text');
  check((await a.request(`/api/rooms/${room.id}/messages`,'POST',{envelope:JSON.stringify(env)})).status===202,'private encrypted relay');
  check(await decryptMessage(rkey,(await bs.wait(e=>e.data.message?.id===env.id)).data.message.body,rscope,a.me.id)==='private room text','private recipient decrypts');
  await a.request(`/api/rooms/${room.id}`,'DELETE'); await delay(100); check(bs.state.closed,'room close revokes open stream');
  check((await db.select().from(messages)).length===0,'no new message content stored anywhere in messages table');

  const token=a.jar.get('roulette_session_v2');
  const [row]=await db.select().from(sessions).where(eq(sessions.tokenHash,createHash('sha256').update(token).digest('hex')));
  check(row?.userId===a.me.id && row.tokenHash!==token,'session token stored only as a digest');
  await db.update(sessions).set({expiresAt:new Date(0)}).where(eq(sessions.userId,a.me.id));
  check((await a.request('/api/stranger/events')).status===401,'server enforces session expiry');
  await db.update(sessions).set({expiresAt:new Date(Date.now()+700)}).where(eq(sessions.userId,outsider.me.id));
  const shortStream=await stream(outsider,'/api/stranger/events');
  await shortStream.wait(e=>e.event==='ready');
  await delay(900);
  check(shortStream.state.closed,'open stream expires with its authenticated session');
  console.log(`PASS: ${checks} isolated API/security assertions`);
} finally {
  for(const s of openStreams)s.close();
  if(ids.length)await db.delete(users).where(inArray(users.id,ids));
  assert.equal((await db.select().from(users).where(eq(users.id,canary.id))).length,1,'unrelated data survived tests');
  await db.delete(users).where(eq(users.id,canary.id));
  await pool.end();
}
