/*
 * Real-browser, two-person regression suite.
 * Install browser tooling outside production: npm i --no-save playwright
 * and npx playwright install --with-deps chromium.
 * Run: BASE=https://your-preview.example node scripts/browser-check.mjs
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [];
const passed = [];

async function user(context) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return page;
}

const note = (name) => { passed.push(name); console.log('PASS', name); };
const localChats = page => page.evaluate(() => JSON.parse(localStorage.getItem('luma-local-chats-v1') || '[]'));
const waitForWaitingSeat = async page => {
  await page.waitForFunction(() => {
    const chats = JSON.parse(localStorage.getItem('luma-local-chats-v1') || '[]');
    return chats.some(chat => chat.status === 'waiting' && chat.encryption?.mode === 'ecdh');
  }, null, { timeout: 15_000 });
  return (await localChats(page)).find(chat => chat.status === 'waiting');
};
const waitForComposer = async page => {
  await page.locator('textarea').waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => {
    const editor = document.querySelector('textarea');
    return editor && !editor.disabled;
  }, { timeout: 20_000 });
};
const start = page => page.getByRole('button', { name: 'Chat with a stranger' }).click();
const end = async page => {
  await page.getByRole('button', { name: 'Leave chat' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'End chat' }).click();
  await page.getByRole('button', { name: 'Chat with a stranger' }).waitFor({ timeout: 12_000 });
};
const cancel = async page => {
  await page.getByRole('button', { name: 'Cancel search' }).click();
  await page.getByRole('button', { name: 'Chat with a stranger' }).waitFor({ timeout: 12_000 });
};
const context = () => browser.newContext();

try {
  const ctxA = await context();
  const ctxB = await context();
  const a = await user(ctxA);
  const b = await user(ctxB);
  assert.equal(await a.locator('#safety-guide').count(), 1);
  assert.equal(await a.locator('label input[type=checkbox]').count(), 0, 'no fake consent gate');
  assert.equal(await a.locator('#safety-guide ol > li').count(), 8, 'the eight common problems are visible');
  assert.equal(await a.locator('#safety-guide button, #safety-guide a, #safety-guide input, #safety-guide select, #safety-guide details, #safety-guide summary').count(), 0, 'the guide is plain, non-interactive HTML');
  const topicTitles = await a.locator('#safety-guide ol > li > h3').allInnerTexts();
  assert.match(topicTitles.join('\n'), /Swearing/i);
  assert.match(await a.locator('#safety-guide ol > li').first().innerText(), /Why it happens/i);
  assert.notEqual((await a.locator('#safety-guide ol > li').first().locator('p').first().innerText()).trim(), 'Why it happens');
  note('Guide renders the common problems as static HTML without an entry checkbox');
  for (const code of [
    'zh', 'hi', 'es', 'fr', 'ar', 'bn', 'pt', 'ru', 'ur', 'id',
    'de', 'ja', 'sw', 'mr', 'te', 'tr', 'ta', 'vi', 'ko',
  ]) {
    await a.locator('select').selectOption(code);
    const whyLabel = await a.locator('#safety-guide ol > li').first().locator('strong').first().innerText();
    assert.notEqual(whyLabel.replace(/[:：]\s*$/u, ''), 'Why it happens', `Guide label fell back to English for ${code}`);
    assert.notEqual(await a.locator('#safety-guide h3').last().innerText(),
      'The patterns that follow', `Pattern heading fell back to English for ${code}`);
  }
  await a.locator('select').selectOption('en');
  note('Safety guide headings are translated in all 19 non-English languages');

  const legacyCtx = await context();
  const legacyPage = await user(legacyCtx);
  await legacyPage.evaluate(() => {
    localStorage.setItem('luma-local-chats-v1', JSON.stringify([{
      roomId: `p_${'f'.repeat(32)}`,
      clientId: `guest_${'a'.repeat(32)}`,
      publicId: '11111111-1111-4111-8111-111111111111',
      kind: 'private', status: 'ended',
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
      messages: [{ id: 'old-message', body: 'legacy conversation',
        senderPublicId: '22222222-2222-4222-8222-222222222222',
        senderClientId: 'guest_EXPOSED_PEER_TOKEN_12345678901234567890',
        createdAt: '2025-01-01T00:00:00.000Z' }],
    }]));
  });
  await legacyPage.reload({ waitUntil: 'networkidle' });
  const sanitized = await legacyPage.evaluate(() => localStorage.getItem('luma-local-chats-v1'));
  assert.ok(sanitized?.includes('legacy conversation'));
  assert.ok(!sanitized.includes('senderClientId') && !sanitized.includes('EXPOSED_PEER_TOKEN'));
  note('Legacy transcripts erase peer bearer credentials on read');
  await legacyCtx.close();

  // Reproduces the original 25-second timeout: an actively polling waiting
  // participant must still be matchable when the second person arrives later.
  await start(a);
  await a.getByRole('heading', { name: /Finding someone/ }).waitFor();
  const firstSeat = await waitForWaitingSeat(a);
  assert.ok(firstSeat?.clientId && firstSeat.encryption?.mode === 'ecdh');
  await a.waitForTimeout(31_000);
  await start(b);
  await Promise.all([waitForComposer(a), waitForComposer(b)]);
  assert.equal((await localChats(a))[0].roomId, (await localChats(b))[0].roomId);
  note('Two distinct browsers connect after 31 seconds of queueing');
  const sent = 'Browser A: encrypted hello';
  await a.locator('textarea').fill(sent);
  await a.locator('textarea').press('Enter');
  await b.locator('.chat-scroll').getByText(sent).waitFor({ timeout: 10_000 });
  await a.locator('.chat-scroll').getByText('Delivered').waitFor({ timeout: 10_000 });
  note('Encrypted chat delivers a message and signed receipt');
  await end(a);
  await b.getByText('That chat has ended').waitFor({ timeout: 10_000 });
  assert.equal(await b.locator('textarea').isDisabled(), true);
  note('Leaving immediately closes the other person’s composer');
  await ctxB.close();

  // Next has to finish DELETE before posting a new match, otherwise the old
  // active room can exhaust the per-browser limit or be joined by a late peer.
  const nextCtx = await context();
  const afterNextCtx = await context();
  const nextPeer = await user(nextCtx);
  const afterNext = await user(afterNextCtx);
  await start(a);
  await start(nextPeer);
  await Promise.all([waitForComposer(a), waitForComposer(nextPeer)]);
  await a.getByRole('button', { name: 'Next' }).click();
  await a.getByRole('alertdialog').getByRole('button', { name: 'End & find next' }).click();
  await nextPeer.getByText('That chat has ended').waitFor({ timeout: 10_000 });
  await a.getByRole('heading', { name: /Finding someone/ }).waitFor({ timeout: 10_000 });
  await start(afterNext);
  await Promise.all([waitForComposer(a), waitForComposer(afterNext)]);
  note('Next ends the old room before finding a new person');
  await end(a);
  await ctxA.close(); await nextCtx.close(); await afterNextCtx.close();

  // Reload while waiting. The room and its local E2EE key must be reused,
  // rather than minting a new participant and getting a 429.
  const reloadCtx = await context();
  const guestCtx = await context();
  const waiting = await user(reloadCtx);
  const guest = await user(guestCtx);
  await start(waiting);
  await waiting.getByRole('heading', { name: /Finding someone/ }).waitFor();
  const waitingSeat = await waitForWaitingSeat(waiting);
  await waiting.reload({ waitUntil: 'networkidle' });
  await start(waiting);
  await waiting.getByRole('heading', { name: /Finding someone/ }).waitFor();
  assert.equal((await waitForWaitingSeat(waiting)).roomId, waitingSeat.roomId);
  await start(guest);
  await Promise.all([waitForComposer(waiting), waitForComposer(guest)]);
  note('A reloaded waiting tab resumes the same encrypted queue seat');
  await end(waiting);
  await guest.getByText('That chat has ended').waitFor({ timeout: 10_000 });
  await reloadCtx.close(); await guestCtx.close();

  // Reproduce the old 429: saved abuse session but no local participant key.
  const lostCtx = await context();
  const peerCtx = await context();
  const lost = await user(lostCtx);
  const peer = await user(peerCtx);
  await start(lost);
  await lost.getByRole('heading', { name: /Finding someone/ }).waitFor();
  const orphan = await waitForWaitingSeat(lost);
  await lost.evaluate(() => localStorage.removeItem('luma-local-chats-v1'));
  await lost.reload({ waitUntil: 'networkidle' });
  await start(lost);
  await lost.getByRole('heading', { name: /Finding someone/ }).waitFor();
  const replacement = await waitForWaitingSeat(lost);
  assert.notEqual(orphan.roomId, replacement.roomId);
  await start(peer);
  await Promise.all([waitForComposer(lost), waitForComposer(peer)]);
  const orphanResponse = await lost.evaluate(async (seat) => {
    const response = await fetch(`/api/rooms/${seat.roomId}`, {
      headers: { Authorization: `Bearer ${seat.clientId}` },
    });
    return { status: response.status, body: await response.json() };
  }, orphan);
  assert.ok(orphanResponse.status === 404 || orphanResponse.body.room?.status === 'ended');
  note('Lost local keys replace a stranded wait without a 429 or ghost match');
  await end(lost);
  await lostCtx.close(); await peerCtx.close();

  // Two tabs in the same browser should resume one waiting seat. They must
  // not match each other or endlessly steal and recreate the same queue.
  const sharedCtx = await context();
  const otherCtx = await context();
  const sharedA = await user(sharedCtx);
  const other = await user(otherCtx);
  await start(sharedA);
  await sharedA.getByRole('heading', { name: /Finding someone/ }).waitFor();
  const sharedSeat = await waitForWaitingSeat(sharedA);
  const sharedB = await user(sharedCtx);
  await start(sharedB);
  await sharedB.getByRole('heading', { name: /Finding someone/ }).waitFor();
  assert.equal((await waitForWaitingSeat(sharedB)).roomId, sharedSeat.roomId);
  await start(other);
  await Promise.all([waitForComposer(sharedA), waitForComposer(sharedB), waitForComposer(other)]);
  note('Two tabs share their waiting seat and connect to a distinct browser');
  await end(sharedB);
  await sharedA.getByText('That chat has ended').waitFor({ timeout: 10_000 });
  await sharedCtx.close(); await otherCtx.close();

  // A timed-out or replaced search must have a visible way back; 429 must
  // explain the reason instead of throwing a generic toast that is not shown.
  const rejectionCtx = await context();
  const rejected = await user(rejectionCtx);
  await rejected.route('**/api/match', route => route.fulfill({
    status: 429,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'contact-limit' }),
  }));
  await start(rejected);
  await rejected.getByRole('alert').getByText(/hourly limit/i).waitFor({ timeout: 10_000 });
  assert.equal(await rejected.getByRole('button', { name: 'Chat with a stranger' }).isEnabled(), true);
  note('Match limits have a visible localized explanation and working retry');
  await rejectionCtx.close();

  // A browser that disallows storage should still be able to chat within
  // this tab and should get a clear warning that the keys are ephemeral.
  const blockedCtx = await context();
  await blockedCtx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage blocked', 'SecurityError'); },
    });
  });
  const ordinaryCtx = await context();
  const blocked = await user(blockedCtx);
  const ordinary = await user(ordinaryCtx);
  await blocked.getByText(/blocks local storage/i).waitFor();
  await start(blocked);
  await start(ordinary);
  await Promise.all([waitForComposer(blocked), waitForComposer(ordinary)]);
  const reply = 'Ephemeral key exchange works';
  await blocked.locator('textarea').fill(reply);
  await blocked.locator('textarea').press('Enter');
  await ordinary.locator('.chat-scroll').getByText(reply).waitFor({ timeout: 10_000 });
  note('Storage-blocked browser still connects and encrypts in memory');
  await end(ordinary);
  await blockedCtx.close(); await ordinaryCtx.close();

  // An invite must work independently of the stranger queue.
  const ownerCtx = await context();
  const visitorCtx = await context();
  const owner = await user(ownerCtx);
  await owner.getByRole('button', { name: 'Create private link' }).click();
  await owner.getByRole('button', { name: /Copy invite link/ }).waitFor({ timeout: 10_000 });
  const invite = await owner.evaluate(() => {
    const chats = JSON.parse(localStorage.getItem('luma-local-chats-v1') || '[]');
    const own = chats.find(chat => chat.kind === 'private' && chat.encryption?.mode === 'private');
    if (!own) throw new Error('Private invite key was not saved');
    return `/r/${own.roomId}#k=${own.encryption.secret}`;
  });
  const visitor = await visitorCtx.newPage();
  await visitor.goto(new URL(invite, BASE).href, { waitUntil: 'domcontentloaded' });
  await Promise.all([waitForComposer(owner), waitForComposer(visitor)]);
  await visitor.locator('textarea').fill('Private invite works');
  await visitor.locator('textarea').press('Enter');
  await owner.locator('.chat-scroll').getByText('Private invite works').waitFor({ timeout: 10_000 });
  note('Private invite connects two browsers and delivers encrypted text');
  await end(owner);
  await ownerCtx.close(); await visitorCtx.close();

  assert.deepEqual(errors, [], `Browser page errors: ${errors.join(' | ')}`);
  note('No uncaught browser errors');
  console.log(`\n${passed.length} end-to-end checks passed`);
} catch (error) {
  console.error(`\nBrowser regression failed after ${passed.length} checks:`, error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
