/**
 * Two-browser shared-canvas regression.
 * Install test tooling outside production: npm i --no-save playwright
 * and npx playwright install --with-deps chromium.
 * Run: BASE=https://your-preview.example node scripts/canvas-browser-check.mjs
 *
 * Exercises the original failure (invitation closing immediately), a recipient
 * disappearing before acceptance, retry on return, and encrypted stroke relay.
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:3000';
const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
const ownerCtx = await browser.newContext();
const guestCtx = await browser.newContext();
const owner = await ownerCtx.newPage();
let guest = await guestCtx.newPage();
const fail = [];
owner.on('response', async r => { if (r.url().includes('/canvas') && !r.ok()) fail.push(`${r.status()} ${await r.text().catch(() => '')}`); });
try {
  await owner.goto(BASE, {waitUntil:'networkidle'});
  await owner.getByRole('button',{name:/Create private link/i}).click();
  await owner.getByRole('button',{name:/Copy invite link/i}).waitFor({timeout:20000});
  const invite = await owner.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('luma-local-chats-v1') || '[]').find(c=>c.kind==='private');
    return `/r/${r.roomId}#k=${r.encryption.secret}`;
  });
  await guest.goto(new URL(invite,BASE).href,{waitUntil:'domcontentloaded'});
  await Promise.all([
    owner.locator('textarea:not([disabled])').waitFor({timeout:20000}),
    guest.locator('textarea:not([disabled])').waitFor({timeout:20000}),
  ]);
  await owner.getByRole('button',{name:/Draw together|Draw/i}).click();
  await owner.getByText(/Waiting for|waiting for/i).first().waitFor({timeout:5000});
  await guest.getByRole('button',{name:/Accept/i}).first().waitFor({timeout:5000});
  console.log('PASS recipient sees invite');
  await guest.close();
  await owner.waitForTimeout(8500);
  if (!(await owner.getByText(/Waiting for|waiting for/i).first().isVisible())) throw new Error('sender invitation closed while recipient backgrounded');
  console.log('PASS sender invitation remains open while recipient is away');
  guest = await guestCtx.newPage();
  await guest.goto(new URL(invite,BASE).href,{waitUntil:'domcontentloaded'});
  await guest.locator('textarea:not([disabled])').waitFor({timeout:20000});
  await guest.getByRole('button',{name:/Accept/i}).first().waitFor({timeout:16000});
  console.log('PASS returning recipient receives retried invite');
  await guest.getByRole('button',{name:/Accept/i}).first().click();
  await Promise.all([
    guest.locator('canvas').first().waitFor({timeout:10000}),
    owner.locator('canvas').first().waitFor({timeout:10000}),
  ]);
  console.log('PASS both boards open after return and acceptance');
  const before = await guest.locator('canvas').evaluateAll((canvases) => canvases.slice(0, 2).map((canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) painted++;
    return painted;
  }));
  const board = owner.locator('canvas').last();
  const rect = await board.boundingBox();
  await owner.mouse.move(rect.x + rect.width * 0.35, rect.y + rect.height * 0.35);
  await owner.mouse.down();
  for (let index = 0; index < 14; index++) {
    await owner.mouse.move(rect.x + rect.width * (0.35 + index * 0.015), rect.y + rect.height * (0.35 + index * 0.008));
  }
  await owner.mouse.up();
  await guest.waitForTimeout(1500);
  const after = await guest.locator('canvas').evaluateAll((canvases) => canvases.slice(0, 2).map((canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) painted++;
    return painted;
  }));
  if (!after.some((painted, index) => painted > before[index])) throw new Error(`stroke did not reach peer: before=${before} after=${after}`);
  console.log('PASS stroke appears in recipient layer');
  if (fail.length) throw new Error('canvas HTTP failures: ' + fail.join(' | '));
  console.log('PENDING INVITE CHECK PASSED');
} catch(e) {
  console.error('FAIL',e.message);
  console.error('owner:',(await owner.locator('body').innerText().catch(() => '')).slice(-750));
  console.error('guest:',(await guest.locator('body').innerText().catch(() => '')).slice(-750));
  console.error('canvas errors:',fail.join(' | '));
  console.error('owner textarea:',(await owner.locator('textarea').first().getAttribute('disabled').catch(() => 'none')),'count',await owner.locator('textarea').count(),'visible', await owner.locator('textarea').first().isVisible().catch(() => false),'enabled', await owner.locator('textarea').first().isEnabled().catch(() => false));
  console.error('guest textarea:',(await guest.locator('textarea').first().getAttribute('disabled').catch(() => 'none')),'count',await guest.locator('textarea').count(),'visible', await guest.locator('textarea').first().isVisible().catch(() => false),'enabled', await guest.locator('textarea').first().isEnabled().catch(() => false));
  console.error('owner canvas button:', await owner.getByRole('button',{name:/Draw together|Draw/i}).count().catch(() => -1));
  process.exitCode=1;
} finally { await browser.close(); }
