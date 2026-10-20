/**
 * Multi-viewport chat + shared-canvas layout & interaction regression suite.
 * Verifies compact 48px active-chat header, zero document overflow across desktop/mobile,
 * fast private-invite join activation (<3s instead of 20s poll stall), right-click stroke guard,
 * bottom scroll pinning when canvas opens, mobile slide-over chats drawer, and Expand/Compact toggle.
 *
 * Run: BASE=http://127.0.0.1:3000 node scripts/layout-browser-check.mjs
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto(BASE, { waitUntil: 'networkidle' });
  await a.getByRole('button', { name: /Create private link/i }).click();
  await a.getByRole('button', { name: /Copy invite link/i }).waitFor({ timeout: 5000 });
  const invite = await a.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('luma-local-chats-v1') || '[]').find(c => c.kind === 'private');
    return `/r/${r.roomId}#k=${r.encryption.secret}`;
  });

  const t0 = Date.now();
  await b.goto(new URL(invite, BASE).href, { waitUntil: 'domcontentloaded' });
  await b.locator('textarea:not([disabled])').waitFor({ timeout: 5000 });
  await b.locator('textarea').fill('Instant 0ms guest message right after join!');
  await b.locator('textarea').press('Enter');
  await a.locator('textarea:not([disabled])').waitFor({ timeout: 5000 });
  const ownerUnlockMs = Date.now() - t0;
  console.log(`PASS private-room owner unlocked in ${ownerUnlockMs}ms`);
  assert.ok(ownerUnlockMs < 3000, `Expected owner unlock <3000ms, got ${ownerUnlockMs}ms`);
  await a.locator('.chat-scroll').getByText('Instant 0ms guest message right after join!').waitFor({ timeout: 5000 });
  console.log('PASS instant 0ms guest message decrypted and delivered');

  for (let i = 1; i <= 8; i++) {
    await a.locator('textarea').fill(`Message #${i}: verifying scroll pinning when shared canvas opens!`);
    await a.locator('textarea').press('Enter');
    await a.waitForTimeout(70);
  }
  await b.locator('.chat-scroll').getByText('Message #8').waitFor({ timeout: 5000 });

  await a.getByRole('button', { name: /Draw together/i }).click();
  await b.getByRole('button', { name: /Accept/i }).first().waitFor({ timeout: 5000 });
  await b.getByRole('button', { name: /Accept/i }).first().click();
  await Promise.all([
    a.locator('canvas[data-layer="input"]').waitFor({ timeout: 5000 }),
    b.locator('canvas[data-layer="input"]').waitFor({ timeout: 5000 }),
  ]);
  await a.waitForTimeout(150);

  const canvasBox = await a.locator('canvas[data-layer="input"]').boundingBox();
  await a.mouse.click(canvasBox.x + 40, canvasBox.y + 40, { button: 'right' });
  await a.mouse.move(canvasBox.x + 180, canvasBox.y + 120, { steps: 5 });
  const rightClickInk = await a.evaluate(() => {
    let total = 0;
    for (const c of document.querySelectorAll('canvas[data-layer="bottom"], canvas[data-layer="top"]')) {
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) total++;
    }
    return total;
  });
  assert.equal(rightClickInk, 0, 'Right-click must never draw ghost ink');
  console.log('PASS right-click does not draw ghost strokes');

  const measure = (page) => page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        height: Math.round(r.height),
        width: Math.round(r.width),
        scrollGap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
      };
    };
    return {
      viewport: {
        w: window.innerWidth,
        h: window.innerHeight,
        docScrollH: document.documentElement.scrollHeight,
        docScrollW: document.documentElement.scrollWidth,
      },
      header: rect('header'),
      chatScroll: rect('.chat-scroll'),
      canvas: rect('canvas[data-layer="input"]'),
      composer: rect('form'),
    };
  });

  const mDesktop = await measure(a);
  const mMobile = await measure(b);
  assert.equal(mDesktop.header.height, 48, 'Compact 48px room header on desktop');
  assert.equal(mDesktop.viewport.docScrollH, 720, 'Zero page vertical overflow on 1280x720');
  assert.equal(mDesktop.viewport.docScrollW, 1280, 'Zero page horizontal overflow on 1280x720');
  assert.ok(mDesktop.chatScroll.height >= 350, `Expected desktop chatScroll >=350px, got ${mDesktop.chatScroll.height}`);
  assert.ok(mDesktop.chatScroll.scrollGap <= 5, `Scroll stays pinned to bottom when canvas opens (gap=${mDesktop.chatScroll.scrollGap})`);

  assert.equal(mMobile.header.height, 48, 'Compact 48px room header on mobile');
  assert.equal(mMobile.viewport.docScrollH, 844, 'Zero page vertical overflow on 390x844');
  assert.equal(mMobile.viewport.docScrollW, 390, 'Zero page horizontal overflow on 390x844');
  assert.ok(mMobile.chatScroll.height >= 470, `Expected mobile chatScroll >=470px, got ${mMobile.chatScroll.height}`);
  console.log(`PASS viewport geometry verified: Desktop chat=${mDesktop.chatScroll.height}px, Mobile chat=${mMobile.chatScroll.height}px`);

  await b.setViewportSize({ width: 360, height: 667 });
  await b.waitForTimeout(100);
  const mSmall = await measure(b);
  assert.equal(mSmall.viewport.docScrollW, 360, 'Zero horizontal overflow at 360px');
  assert.equal(mSmall.viewport.docScrollH, 667, 'Zero vertical overflow at 667px');
  assert.ok(mSmall.chatScroll.height >= 310, `Expected 360x667 chatScroll >=310px, got ${mSmall.chatScroll.height}`);
  console.log(`PASS 360x667 small-phone geometry verified: chat=${mSmall.chatScroll.height}px`);

  await b.getByRole('button', { name: 'Your chats' }).click();
  await b.getByRole('dialog', { name: 'Your chats' }).waitFor({ timeout: 3000 });
  await b.keyboard.press('Escape');
  assert.equal(await b.getByRole('dialog', { name: 'Your chats' }).count(), 0, 'Escape closes mobile chats drawer');
  console.log('PASS mobile slide-over chats drawer + Escape verified');

  await a.getByRole('button', { name: 'Expand canvas' }).click();
  const expandedCanvasH = (await measure(a)).canvas.height;
  await a.getByRole('button', { name: 'Compact canvas' }).click();
  const compactCanvasH = (await measure(a)).canvas.height;
  assert.ok(expandedCanvasH > compactCanvasH + 50, `Expand toggle grows board (${compactCanvasH} -> ${expandedCanvasH})`);
  console.log(`PASS canvas Expand/Compact toggle verified (${compactCanvasH}px <-> ${expandedCanvasH}px)`);

  await a.getByRole('button', { name: 'Leave chat' }).click();
  await a.getByRole('alertdialog').getByRole('button', { name: 'End chat' }).click();
  console.log('ALL LAYOUT & INTERACTION CHECKS PASSED');
} finally {
  await browser.close();
}
