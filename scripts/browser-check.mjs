/**
 * Two-browser smoke test for Luma.
 *
 * Prerequisite (kept out of app dependencies):
 *   npm i --no-save playwright && npx playwright install --with-deps chromium
 * Run:
 *   BASE=http://localhost:3000 node scripts/browser-check.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:3000';
let failures = 0; const check = (n,c,e='') => { console.log(`${c?'PASS':'FAIL'}  ${n}${e?' — '+e:''}`); if(!c) failures++; };
const browser = await chromium.launch({ headless: true, args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'] });
const ctxA = await browser.newContext(); const ctxB = await browser.newContext();
const errors = [];
const hook = () => { window.__tones = 0; const O = window.AudioContext; if(!O) return; const c = O.prototype.createOscillator; O.prototype.createOscillator = function(...a){ const o=c.apply(this,a); const s=o.start.bind(o); o.start=(...x)=>{ window.__tones+=1; return s(...x); }; return o; }; };
for (const [l,c] of [['A',ctxA],['B',ctxB]]) { await c.addInitScript(hook); c.on('page', p => { p.on('pageerror', e=>errors.push(`${l}: ${e.message}`)); p.on('console', m=>{ if(m.type()==='error') errors.push(`${l}: ${m.text()}`); }); }); }
const pageA = await ctxA.newPage(); const pageB = await ctxB.newPage();
await pageA.goto(BASE, { waitUntil:'networkidle' }); await pageB.goto(BASE, { waitUntil:'networkidle' });
check('hero renders', await pageA.getByRole('heading', { name:/Meet someone/i }).count() === 1);
check('safety guide section renders', await pageA.locator('#safety-guide').count() === 1);
check('guide lists every problem without a checkbox', (await pageA.locator('#safety-guide article').count()) >= 9 && (await pageA.locator('#safety-guide button, #safety-guide input').count()) === 0, String(await pageA.locator('#safety-guide article').count()));
check('20 languages in selector', await pageA.locator('select option').count() === 20, String(await pageA.locator('select option').count()));
for (const [code, marker] of [['es','Conoce a alguien'],['fr','Rencontrez'],['de','Triff jemanden'],['ja','新しい'],['ko','새로운 사람을'],['hi','किसी'],['ar','قابل'],['ru','Познакомьтесь'],['zh','遇见'],['vi','Gặp một người'],['tr',''],['ta',''],['te',''],['bn',''],['sw',''],['mr',''],['id',''],['pt',''],['ur',''],['it','']]) {
  if (!marker) continue;
  await pageA.locator('select').selectOption(code); await pageA.waitForTimeout(120);
  const txt = await pageA.locator('body').innerText();
  check(`translated hero (${code})`, txt.includes(marker));
}
await pageA.locator('select').selectOption('ja'); await pageA.waitForTimeout(400);
check('guide translated (ja)', (await pageA.locator('#safety-guide').innerText()).includes('よくある問題'));
await pageA.locator('select').selectOption('de'); await pageA.waitForTimeout(400);
check('guide translated (de)', (await pageA.locator('#safety-guide').innerText()).includes('Typische Probleme'));
await pageA.locator('select').selectOption('en'); await pageA.waitForTimeout(150);
await pageA.getByRole('button', { name:/Chat with a stranger/i }).click();
await pageB.getByRole('button', { name:/Chat with a stranger/i }).click();
await pageA.waitForSelector('textarea', { timeout: 15000 }); await pageB.waitForSelector('textarea', { timeout: 15000 });
check('both matched into chat', await pageA.locator('textarea').isEnabled() && await pageB.locator('textarea').isEnabled());
check('match sound attempted on A', (await pageA.evaluate(() => window.__tones||0)) > 0);
await pageA.locator('textarea').fill('round two: hello A');
await pageA.keyboard.press('Enter');
await pageB.waitForSelector('text=round two: hello A', { timeout: 10000 });
check('E2E message rendered on peer', true);
check('receive sound attempted on B', (await pageB.evaluate(() => window.__tones||0)) > 0);
await pageA.locator('textarea').pressSequentially('typing test', { delay: 40 });
await pageB.waitForSelector('text=typing…', { timeout: 5000 }).catch(() => {});
const typingNow = await pageB.locator('text=typing…').count();
check('typing indicator works', typingNow >= 1, `after=${typingNow}`);
await pageA.locator('textarea').fill('');
await pageA.waitForTimeout(4600);
check('typing indicator clears when idle', (await pageB.locator('text=typing…').count()) === 0);
const toggle = pageA.locator('header button[aria-pressed]').first();
await toggle.click(); const off = await toggle.getAttribute('aria-label');
const persisted = await pageA.evaluate(() => localStorage.getItem('luma-sound-enabled-v1'));
check('sound preference persists', off?.includes('Sound off') && persisted === 'off', `${off} / stored=${persisted}`);
await pageA.locator('header button[aria-pressed]').first().click();
const storedOn = await pageA.evaluate(() => localStorage.getItem('luma-sound-enabled-v1'));
check('sound preference toggles back on', storedOn === 'on', String(storedOn));
const reportBtn = pageA.locator('button[title="Report"]').first();
if (await reportBtn.count()) {
  await reportBtn.click();
  check('report dialog opens', await pageA.getByRole('dialog').count() === 1);
  await pageA.getByRole('button', { name:'Spam or automation' }).click();
  await pageA.waitForTimeout(700);
  check('report submits', (await pageA.locator('body').innerText()).includes('Safety signal sent'));
} else check('report button available', false);
await pageA.locator('#safety-guide').count();
await pageA.locator('button[aria-label="Leave chat"]').click();
await pageA.getByRole('button', { name:'End chat' }).click();
await pageB.waitForSelector('text=That chat has ended', { timeout: 12000 });
check('peer instantly sees chat ended', true);
const home = await ctxA.newPage(); await home.goto(BASE, { waitUntil:'networkidle' });
await home.locator('#safety-guide').scrollIntoViewIfNeeded();

check('no browser errors', errors.length === 0, errors.slice(0,3).join(' | '));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL BROWSER CHECKS PASSED');
process.exit(failures?1:0);
