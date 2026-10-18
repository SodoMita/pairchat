// Real Chromium, two independent browser contexts. Never run against users.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
if(process.env.REVIEW_ISOLATED!=='1')throw new Error('Run through tests/run-review.mjs');
const BASE=process.env.BASE;
const browser=await chromium.launch({headless:true});
const contexts=[];
const errors=[];
const external=[];
const plaintextLeaks=[];
async function context(){
  const ctx=await browser.newContext({locale:'en-US'});contexts.push(ctx);
  ctx.on('page',page=>{
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{
      if(/^https?:/.test(r.url()) && new URL(r.url()).origin!==BASE)external.push(r.url());
      if(r.url().includes('/messages') && r.method()==='POST' && /BROWSER_SECRET_/.test(r.postData()||''))plaintextLeaks.push(r.url());
    });
  });
  return ctx;
}
async function ready(page){await page.locator('input[autocomplete="off"]').waitFor();await page.waitForFunction(()=>{const e=document.querySelector('input[autocomplete="off"]');return e && !e.disabled;});}
async function send(page,text){await ready(page);await page.locator('input[autocomplete="off"]').fill(text);await page.getByRole('button',{name:'Send',exact:true}).click();}
async function has(page,text){await page.getByTestId('message-body').filter({hasText:text}).waitFor();}
try{
  const a=await context(), b=await context(); const pa=await a.newPage(), pb=await b.newPage();
  const requests=[];pa.on('request',r=>requests.push([r.method(),new URL(r.url()).pathname]));
  await pa.goto(BASE+'/chat/stranger'); await pb.goto(BASE+'/chat/stranger');
  await ready(pa);await ready(pb);
  await send(pa,'BROWSER_SECRET_A 🔐');await has(pb,'BROWSER_SECRET_A 🔐');await has(pa,'BROWSER_SECRET_A 🔐');
  await send(pb,'BROWSER_SECRET_B 🌍');await has(pa,'BROWSER_SECRET_B 🌍');
  await pa.reload();await ready(pa);await has(pa,'BROWSER_SECRET_A 🔐');await has(pa,'BROWSER_SECRET_B 🌍');
  await pb.reload();await ready(pb);await has(pb,'BROWSER_SECRET_A 🔐');await has(pb,'BROWSER_SECRET_B 🌍');
  assert.equal(await pa.getByTestId('message-body').count(),2,'self echo/history are deduplicated');
  console.log('PASS browser: stranger send/receive/self echo + both reloads');
  await pa.evaluate(() => {
    Object.defineProperty(document,'hidden',{value:true,configurable:true});
    window.__notices=[];
    window.addEventListener('chatterbox:incoming-message',e=>window.__notices.push(e.detail));
  });
  await send(pb,'BROWSER_SECRET_XSS <img src=x onerror="window.__pwned=1">');
  await has(pa,'BROWSER_SECRET_XSS');
  await pa.waitForFunction(()=>document.title.startsWith('(1)'));
  assert.equal(await pa.locator('img[src="x"]').count(),0);
  const notice=await pa.evaluate(()=>({payload:window.__notices,pwned:window.__pwned}));
  assert.equal(notice.pwned,undefined);assert.equal(notice.payload.length,1);
  assert.deepEqual(Object.keys(notice.payload[0]),['id']);
  await pa.evaluate(()=>{Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  await pa.waitForFunction(()=>!document.title.startsWith('('));
  console.log('PASS browser: encrypted incoming alerts count once, omit content, and render HTML as text');
  await pa.getByRole('button',{name:'Leave',exact:true}).click();
  await pa.getByRole('dialog').waitFor();
  await pa.getByRole('button',{name:'Stay',exact:true}).press('Enter');
  await pa.getByRole('dialog').waitFor({state:'hidden'});
  await ready(pa);assert.equal(new URL(pa.url()).pathname,'/chat/stranger');
  await send(pa,'BROWSER_SECRET_after_cancel');await has(pb,'BROWSER_SECRET_after_cancel');
  await pa.getByRole('button',{name:'Leave',exact:true}).click();
  await pa.getByRole('dialog').getByRole('button',{name:'Leave',exact:true}).click();
  await pa.waitForURL(BASE+'/');
  await pb.getByText('Partner disconnected',{exact:false}).first().waitFor();
  assert.equal(await pb.locator('input[autocomplete="off"]').isDisabled(),true);
  checkNoPolling(requests);
  console.log('PASS browser: cancel does not leave, confirm ends partner, no matchmaking polling');
  const archive=await pa.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('chatterbox.local.rooms')||'{}')).find(r=>r.kind==='stranger'&&r.active===false));
  assert.ok(archive?.ownerId,'archive remembers the browser owner');
  const archivePage=await a.newPage(), archiveApiRequests=[];
  archivePage.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))archiveApiRequests.push(r.url());});
  await archivePage.goto(BASE+'/history/'+encodeURIComponent(archive.id));
  try { await has(archivePage,'BROWSER_SECRET_A 🔐');await has(archivePage,'BROWSER_SECRET_B 🌍'); }
  catch (error) { console.log('Archive diagnostics:', { url: archivePage.url(), headings: await archivePage.getByRole('heading').allTextContents(), pageErrors: errors, scope: archive.id }); throw error; }
  await archivePage.waitForTimeout(250);
  assert.deepEqual(archiveApiRequests,[],'archive is entirely local');
  await archivePage.close();
  console.log('PASS browser: ended chat opens local read-only history without contacting API');

  // Host creates a real invite from UI (key generated client-side).
  const host=await context(), guest=await context(), attacker=await context();
  const ph=await host.newPage(), pg=await guest.newPage(), pe=await attacker.newPage();
  await ph.goto(BASE+'/');
  await ph.getByRole('button',{name:'Add passphrase (optional)',exact:true}).click();
  await ph.getByLabel('Choose a passphrase',{exact:true}).fill('browser passphrase');
  await ph.getByRole('button',{name:'Create new room',exact:true}).click();
  await ph.waitForURL(/\/room\/.*#/); await ready(ph);
  const invite=ph.url();assert.equal(new URL(invite).hash.length,44);
  await pe.goto(invite.split('#')[0]);
  await pe.getByRole('heading',{name:'The invite link is missing its encryption key.'}).waitFor();
  await pg.goto(invite);
  await pg.getByRole('heading',{name:'Passphrase required',exact:true}).waitFor();
  await pg.getByPlaceholder('Enter the passphrase…').fill('wrong');
  await pg.getByRole('button',{name:'Join with passphrase',exact:true}).click();
  await pg.getByRole('alert').filter({hasText:'Incorrect passphrase'}).waitFor();
  await pg.getByPlaceholder('Enter the passphrase…').fill('browser passphrase');
  await pg.getByRole('button',{name:'Join with passphrase',exact:true}).click();
  await ready(pg);
  await send(ph,'BROWSER_SECRET_room_one');await has(pg,'BROWSER_SECRET_room_one');
  await pg.reload();await ready(pg);await has(pg,'BROWSER_SECRET_room_one');
  await send(pg,'BROWSER_SECRET_room_reply');await has(ph,'BROWSER_SECRET_room_reply');
  console.log('PASS browser: fragment invite, passphrase retry, guest rejoin and private history');
  const second=await host.newPage();await second.goto(BASE+'/');
  await second.getByRole('button',{name:'Create new room',exact:true}).click();await second.waitForURL(/\/room\/.*#/);await ready(second);
  assert.equal(await second.getByTestId('message-body').count(),0,'no transcript leaks across rooms');
  await send(ph,'BROWSER_SECRET_room_one_still_live');await has(pg,'BROWSER_SECRET_room_one_still_live');
  console.log('PASS browser: concurrent private rooms and history isolation');

  // Page bundles and persistent streams must remain same-origin.
  assert.deepEqual(external,[]);assert.deepEqual(plaintextLeaks,[]);assert.deepEqual(errors,[]);
  console.log('PASS browser: no third-party fetches, plaintext network leaks or page exceptions');
} finally { for(const ctx of contexts)await ctx.close(); await browser.close(); }
function checkNoPolling(requests){assert.equal(requests.filter(([method,path])=>method==='GET'&& ['/api/stranger/start','/api/stranger/partner-key','/api/me'].includes(path)).length,0);}
