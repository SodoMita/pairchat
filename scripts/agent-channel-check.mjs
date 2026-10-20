/**
 * End-to-end verification for Mayfly-compatible AI agent channels (/c/<id>#<key>).
 * Tests:
 *  - /llms.txt, /docs/*.md, and /static/{create,client}.{mjs,py}
 *  - Zero-dependency CLI channel creation (POST /new -> 303)
 *  - Content negotiation on GET /c/<id> (plain text for curl/agents vs HTML React viewer for browsers)
 *  - Twin-agent compare-and-swap (CAS) conflict detection (409) & recovery
 *  - Instant long-poll wakeup on POST --wait S
 *  - Live human browser viewer + composer + /title + /react interoperating with CLI agents
 *  - Authenticated channel destruction (DELETE /c/<id> -> 204 -> immediate 404 everywhere)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.BASE || "http://localhost:3000").replace(/\/+$/, "");

function runNode(scriptPath, args, stdinText = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (stdinText) child.stdin.write(stdinText, "utf8");
    child.stdin.end();
  });
}

const work = mkdtempSync(path.join(tmpdir(), "luma-mayfly-test-"));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

try {
  // 1. Discoverability & single-file downloads
  const llmsRes = await fetch(`${BASE}/llms.txt`);
  assert.equal(llmsRes.status, 200);
  assert.match(llmsRes.headers.get("content-type") || "", /text\/plain/);
  assert.match(await llmsRes.text(), /create\.mjs/);
  console.log("PASS /llms.txt serves plain-text agent discovery index");

  for (const doc of ["protocol.md", "clients.md", "create.md"]) {
    const r = await fetch(`${BASE}/docs/${doc}`);
    assert.equal(r.status, 200, doc);
  }
  const pyCheck = await fetch(`${BASE}/static/client.py`);
  assert.equal(pyCheck.status, 200);

  const createSrc = await (await fetch(`${BASE}/static/create.mjs`)).text();
  const clientSrc = await (await fetch(`${BASE}/static/client.mjs`)).text();
  const createPath = path.join(work, "create.mjs");
  const clientPath = path.join(work, "client.mjs");
  writeFileSync(createPath, createSrc, "utf8");
  writeFileSync(clientPath, clientSrc, "utf8");
  console.log("PASS downloaded single-file zero-dependency create.mjs & client.mjs");

  // 2. Mint channel via downloaded create.mjs
  const created = await runNode(createPath, [BASE]);
  assert.equal(created.code, 0, created.stderr);
  const channelUrl = created.stdout.trim();
  assert.match(channelUrl, /^https?:\/\/.+\/c\/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$/);
  const urlWithoutHash = channelUrl.split("#")[0];
  console.log("PASS created ephemeral E2EE agent channel via CLI");

  // 3. Content negotiation on /c/<id>: plain text for curl/agents
  const curlView = await fetch(urlWithoutHash, { headers: { Accept: "*/*" } });
  assert.equal(curlView.status, 200);
  assert.match(curlView.headers.get("content-type") || "", /text\/plain/);
  assert.match(curlView.headers.get("vary") || "", /Accept/i);
  assert.match(await curlView.text(), /client\.mjs/);
  console.log("PASS GET /c/<id> content-negotiates plain-text instructions for agents");

  // 4. Twin-agent CAS conflict & recovery + long-poll wakeup
  const emptyRead = await runNode(clientPath, [channelUrl, "read", "--last", "-1"]);
  assert.equal(emptyRead.code, 0, emptyRead.stderr);
  assert.deepEqual(JSON.parse(emptyRead.stdout), { last: -1, more: false, messages: [] });

  const twin1First = await runNode(
    clientPath,
    [channelUrl, "post", "--from", "TwinAlpha", "--last", "-1"],
    "I am handling the API routes in src/app/c/; please take UI polish.",
  );
  assert.equal(twin1First.code, 0, twin1First.stderr);
  assert.equal(JSON.parse(twin1First.stdout).id, 0);

  // TwinBeta posts with stale cursor --last -1 -> must get exit 1 + conflict + TwinAlpha's message!
  const twin2Conflict = await runNode(
    clientPath,
    [channelUrl, "post", "--from", "TwinBeta", "--last", "-1"],
    "Wait, I was going to edit src/app/c/ too!",
  );
  assert.equal(twin2Conflict.code, 1);
  const conflictJson = JSON.parse(twin2Conflict.stdout);
  assert.equal(conflictJson.posted, false);
  assert.equal(conflictJson.error, "conflict");
  assert.equal(conflictJson.last, 0);
  assert.equal(conflictJson.messages[0].from, "TwinAlpha");
  console.log("PASS compare-and-swap catches stale cursor (409) and returns missed peer turn");

  // TwinAlpha posts seq 1 and waits (--wait 10) while TwinBeta replies at seq 2 -> instant wakeup!
  const t0 = Date.now();
  const twin1WaitPromise = runNode(
    clientPath,
    [channelUrl, "post", "--from", "TwinAlpha", "--last", "0", "--wait", "10"],
    "/title Twin Agent Sync",
  );
  await new Promise((r) => setTimeout(r, 250));
  const twin2Reply = await runNode(
    clientPath,
    [channelUrl, "post", "--from", "TwinBeta", "--last", "1"],
    "Understood! I saw your seq 0 note and will stay on tests only.",
  );
  assert.equal(twin2Reply.code, 0, twin2Reply.stderr);
  const twin1Woken = await twin1WaitPromise;
  assert.equal(twin1Woken.code, 0, twin1Woken.stderr);
  const wokenPayload = JSON.parse(twin1Woken.stdout);
  assert.equal(wokenPayload.posted, true);
  assert.equal(wokenPayload.id, 1);
  assert.equal(wokenPayload.messages[0].from, "TwinBeta");
  assert.ok(Date.now() - t0 < 5000, "long-poll woke immediately on peer reply");
  console.log("PASS post --wait wakes immediately with decrypted twin reply");

  // 5. Open exact same URL in real Chromium browser (Accept: text/html)
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(channelUrl, { waitUntil: "domcontentloaded" });

  await page.getByRole("heading", { name: "Twin Agent Sync" }).waitFor({ timeout: 10_000 });
  await page.getByText(/stay on tests only/i).waitFor({ timeout: 10_000 });
  await page.locator('input[aria-label="Sender name"]').fill("HumanLead");
  await page.locator("textarea").fill("Looks great to me, ship when green!");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByText("Looks great to me, ship when green!").waitFor({ timeout: 10_000 });

  const agentReadsHuman = await runNode(clientPath, [channelUrl, "read", "--last", "2"]);
  assert.equal(agentReadsHuman.code, 0, agentReadsHuman.stderr);
  const humanTurn = JSON.parse(agentReadsHuman.stdout).messages[0];
  assert.equal(humanTurn.from, "HumanLead");
  assert.equal(humanTurn.text, "Looks great to me, ship when green!");
  console.log("PASS human browser viewer decrypts agent turns, renders /title, and posts back to CLI agents");

  // 6. Delete channel via CLI -> 204 -> browser sees channel gone & CLI sees 404
  const del = await runNode(clientPath, [channelUrl, "delete"]);
  assert.equal(del.code, 0, del.stderr);
  await page.getByText(/deleted or expired on the server/i).waitFor({ timeout: 10_000 });
  const afterDel = await runNode(clientPath, [channelUrl, "read", "--last", "-1"]);
  assert.equal(afterDel.code, 1);
  assert.equal(JSON.parse(afterDel.stderr).status, 404);
  assert.deepEqual(pageErrors, []);
  console.log("PASS channel deletion (204) immediately notifies browser long-poll and returns 404");

  await ctx.close();
  console.log("\nALL AGENT CHANNEL CHECKS PASSED");
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
