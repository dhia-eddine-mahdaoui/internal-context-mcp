// Regenerates docs/screenshots/*.png and docs/demo.gif (+ demo.mp4) from REAL runs of the server.
//   npm run docs            (needs: google-chrome, playwright-core, and an ffmpeg binary: FFMPEG=<path>, or `pip install imageio-ffmpeg`)
// Everything runs on localhost against a throwaway directory; caller keys are generated at runtime and never written to the repo.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ContextIndex } from '../dist/src/index.js';
import { createContext } from '../dist/src/tools.js';
import { createHttpServer } from '../dist/src/http.js';
import { IdentityStore, generateIdentities, writeIdentityConfig } from '../dist/src/identity.js';
import { loadQuestions, runEval } from '../dist/src/eval.js';
import { evalPage, transcriptPage } from './pages.mjs';

// Playwright can reject an internal 'first navigation' promise when a page is closed right after use; that is not a failure here.
process.on('unhandledRejection', e => { if (e?.name !== 'TargetClosedError') throw e; });

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'docs', 'screenshots');
mkdirSync(shots, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'ctx-docs-'));
const NOW = '2026-11-01';

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  return execFileSync(process.env.PYTHON ?? 'python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
}

// ---- real server with per-caller identities, audit log and inspector ----
const { config, keys } = generateIdentities([
  { id: 'agent-support', role: 'employee' }, { id: 'agent-payments', role: 'payments' }, { id: 'agent-hr', role: 'hr' }, { id: 'ops-admin', role: 'admin' },
]);
const identFile = join(work, 'identities.local.json');
writeIdentityConfig(identFile, config);
const audit = join(work, 'audit.jsonl');
const index = new ContextIndex(join(root, 'kb'), join(work, 'index.json'));
index.reindex();
const ctx = createContext(index, { now: () => new Date(NOW), auditLog: audit });
const server = createHttpServer(ctx, { identities: new IdentityStore(config), inspector: true });
server.listen(0, 'localhost');
await once(server, 'listening');
const base = `http://localhost:${server.address().port}`;

// ---- real MCP stdio session (separate process, bound to agent-support) ----
async function mcpTranscript() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'dist/src/cli.js'), 'mcp', '--kb', join(root, 'kb'), '--cache', join(work, 'mcp-index.json'), '--identities', identFile, '--as', 'agent-support', '--now', NOW],
    stderr: 'ignore',
  });
  const client = new Client({ name: 'demo-client', version: '1.0.0' });
  await client.connect(transport);
  const steps = [];
  const trim = r => {
    const o = JSON.parse(r.content[0].text);
    if (o.sources) o.sources = o.sources.map(s => ({ ref: s.ref, doc_id: s.doc_id, type: s.type, last_updated: s.last_updated, freshness: s.freshness, confidence: s.confidence, in_conflict: s.in_conflict, snippet: s.snippet }));
    if (o.conflicts) o.conflicts = o.conflicts.map(c => ({ kind: c.kind, note: c.note, ...(c.claim_evidence ? { claim_evidence: c.claim_evidence.map(e => ({ doc_id: e.doc_id, claim: e.claim })) } : {}) }));
    delete o.question; delete o.role; delete o.warnings;
    return o;
  };
  const call = async (title, name, args) => { const r = await client.callTool({ name, arguments: args }); steps.push({ title, request: { name, arguments: args }, response: trim(r), error: !!r.isError }); };
  await call('Ask a question; two sources disagree', 'answer_with_sources', { question: 'When do public certificates rotate before expiry?', max_sources: 3 });
  await call('Try to read a restricted page by claiming another role', 'get_document', { doc_id: 'hr-compensation-bands', role: 'hr' });
  await client.close();
  return steps;
}
const steps = await mcpTranscript();
const pages = join(work, 'pages');
mkdirSync(pages);
writeFileSync(join(pages, 'mcp.html'), transcriptPage(steps));
const report = runEval(index, loadQuestions(join(root, 'eval', 'questions.json')), new Date(NOW));
writeFileSync(join(pages, 'eval.html'), evalPage(report, { corpus: 'synthetic knowledge base', documents: index.docs.size }));
writeFileSync(join(work, 'eval.json'), JSON.stringify(report));

const CURSOR = `(() => { const d = document.createElement('div'); d.style.cssText='position:fixed;z-index:99999;width:16px;height:16px;border-radius:50%;background:rgba(47,91,216,.55);border:2px solid #2f5bd8;pointer-events:none;left:-30px;top:-30px;transform:translate(-8px,-8px);transition:transform .08s';
  addEventListener('DOMContentLoaded',()=>document.body.appendChild(d)); addEventListener('mousemove',e=>{d.style.left=e.clientX+'px';d.style.top=e.clientY+'px'}); addEventListener('mousedown',()=>d.style.transform='translate(-8px,-8px) scale(.6)'); addEventListener('mouseup',()=>d.style.transform='translate(-8px,-8px)'); })();`;

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const inspectorUrl = (id, params = '') => `${base}/inspector${params}#key=${keys[id]}`;
try {
  // ---- screenshots ----
  const ctxShot = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 1.5 });
  const shot = async (url, name, ...selectors) => {
    const p = await ctxShot.newPage();
    await p.goto(url);
    for (const sel of selectors) await p.waitForSelector(sel, { timeout: 15000 });
    await p.waitForTimeout(600);
    await p.screenshot({ path: join(shots, name), fullPage: true });
    await p.close();
  };
  const q = s => '?q=' + encodeURIComponent(s);
  // warm the audit log with a few ordinary calls so the table has history
  for (const [id, args] of [['agent-support', { question: 'How many days of paid time off do I get per year?' }], ['agent-payments', { question: 'Why did the ledger record one payment twice?' }]]) {
    await fetch(base + '/call', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keys[id]}` }, body: JSON.stringify({ tool: 'answer_with_sources', arguments: args }) });
  }
  await shot(inspectorUrl('ops-admin', q('When do public certificates rotate before expiry?')), '01-context-inspector.png', '.conf', '#audit table');
  await shot(inspectorUrl('agent-support', q('The primary on-call did not answer the page, when does it escalate?')), '02-conflict-answer.png', '.conf');
  await shot(inspectorUrl('agent-support', '?doc=hr-compensation-bands'), '03-permission-denied.png', '.card .chip.bad');
  await shot(pathToFileURL(join(pages, 'eval.html')).href, '04-eval-table.png');
  await shot(pathToFileURL(join(pages, 'mcp.html')).href + '?static=1', '05-mcp-client-session.png');
  await ctxShot.close();

  // ---- demo recording ----
  // Deterministic: the page is driven step by step, a screenshot is taken after each step and held for a chosen time, so the GIF's
  // pacing does not depend on how fast this machine renders.
  const rec = await browser.newContext({ viewport: { width: 1100, height: 680 } });
  await rec.addInitScript(CURSOR);
  const page = await rec.newPage();
  const frames = [];
  const snap = async hold => { frames.push({ hold, data: (await page.screenshot({ type: 'jpeg', quality: 85 })).toString('base64') }); };
  const sleep = ms => page.waitForTimeout(ms);
  const moveTo = async sel => {
    const b = await page.locator(sel).boundingBox();
    const tx = b.x + b.width / 2, ty = b.y + b.height / 2;
    for (let i = 1; i <= 5; i++) { await page.mouse.move(tx * i / 5 + (i < 5 ? 40 * (5 - i) / 5 : 0), ty * i / 5 + (i < 5 ? 30 * (5 - i) / 5 : 0)); await snap(0.04); }
  };
  const click = async sel => { await moveTo(sel); await page.mouse.down(); await snap(0.08); await page.mouse.up(); };
  const typeText = async (text, hold = 0.09, chunk = 4) => { for (let i = 0; i < text.length; i += chunk) { await page.keyboard.type(text.slice(i, i + chunk)); await snap(hold); } };
  const scrollBy = async (dy, n, hold) => { for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy / n); await sleep(60); await snap(hold); } };

  // 1) a real MCP session over stdio, replayed step by step
  await page.goto(pathToFileURL(join(pages, 'mcp.html')).href + '?p=0');
  await snap(0.7);
  for (let k = 1; k <= 8; k++) { await page.evaluate(x => window.setProgress(x), 0.4 * k / 8); await snap(0.09); }
  for (let k = 1; k <= 12; k++) { await page.evaluate(x => window.setProgress(x), 0.4 + 0.5 * k / 12); await snap(0.1); }
  await page.evaluate(() => window.setProgress(0.95)); await snap(1.0);
  for (let k = 1; k <= 5; k++) { await page.evaluate(x => window.setProgress(x), 1 + 0.4 * k / 5); await snap(0.09); }
  for (let k = 1; k <= 6; k++) { await page.evaluate(x => window.setProgress(x), 1.4 + 0.6 * k / 6); await snap(0.1); }
  await snap(1.6);

  // 2) the inspector as agent-support: ask, read the conflict, try a restricted page
  await page.goto(inspectorUrl('agent-support'));
  await page.waitForSelector('#audit');
  await sleep(300); await snap(0.8);
  await click('#q'); await typeText('When do public certificates rotate before expiry?');
  await click('#go');
  await page.waitForSelector('.conf'); await sleep(200); await snap(1.8);
  await scrollBy(380, 4, 0.2); await snap(2.2);
  await scrollBy(-600, 2, 0.1);
  await click('#doc'); await typeText('hr-compensation-bands', 0.1, 3);
  await click('#fetchdoc');
  await page.waitForSelector('.card .chip.bad'); await sleep(200); await snap(2.2);

  // 3) reviewer action: an admin caller opens the audit trail
  await click('#key'); await page.keyboard.press('Control+A'); await page.keyboard.type(keys['ops-admin']); await snap(0.5);
  await click('#go');
  await page.waitForSelector('#audit table'); await sleep(200); await snap(1.2);
  await scrollBy(700, 4, 0.2); await snap(2.8);
  await page.close(); await rec.close();
  const total = frames.reduce((a, f) => a + f.hold, 0);
  if (process.env.DEBUG_FRAMES) console.error('frames', frames.length, total.toFixed(1) + 's');
  frames.forEach((f, i) => { f.t = frames.slice(0, i).reduce((a, x) => a + x.hold, 0); });
  const fdir = join(work, 'frames'); mkdirSync(fdir);
  const list = [];
  frames.forEach((f, i) => {
    writeFileSync(join(fdir, `${i}.jpg`), Buffer.from(f.data, 'base64'));
    const next = frames[i + 1];
    list.push(`file '${join(fdir, `${i}.jpg`)}'`, `duration ${f.hold.toFixed(3)}`);
  });
  const webm = join(work, 'frames.txt');
  writeFileSync(webm, list.join(String.fromCharCode(10)) + String.fromCharCode(10));
  const ff = ffmpegPath();
  const gif = join(root, 'docs', 'demo.gif');
  const run = args => execFileSync('nice', ['-n', '10', ff, '-y', '-loglevel', 'error', ...args]);
  run(['-f', 'concat', '-safe', '0', '-i', webm, '-vf', 'fps=10,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', '-loop', '0', gif]);
  run(['-f', 'concat', '-safe', '0', '-i', webm, '-vf', 'fps=25,scale=1100:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', join(root, 'docs', 'demo.mp4')]);
  console.log(JSON.stringify({ gif_bytes: statSync(gif).size, mp4_bytes: statSync(join(root, 'docs', 'demo.mp4')).size, eval: { hybrid: report.modes.hybrid, bm25: report.modes.bm25, leaks: report.leaks } }));
} finally {
  await browser.close();
  server.closeAllConnections(); server.close();
  rmSync(work, { recursive: true, force: true });
}
