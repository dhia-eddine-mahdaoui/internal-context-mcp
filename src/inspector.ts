// Read-only "context inspector": one query in, the retrieved sources with freshness / conflict flags and the audit trail out.
// The page itself carries no data; every number it shows comes from authenticated JSON routes served by http.ts.
import { existsSync, readFileSync } from 'node:fs';
import { Caller } from './identity.js';
import { searchChunks, topDocs } from './search.js';
import { Context, callTool } from './tools.js';
import { Role } from './types.js';

export function inspect(ctx: Context, caller: Caller | undefined, role: Role | undefined, question: string) {
  const args: Record<string, unknown> = { question, max_sources: 5 };
  if (role) args.role = role;
  const answer = callTool(ctx, 'answer_with_sources', args, caller) as { role: Role; sources: Array<Record<string, unknown>> } & Record<string, unknown>;
  // Retrieval internals for the same caller: the two signals behind each source's score (already role-filtered).
  const hits = topDocs(searchChunks(ctx.index, question, { role: answer.role, now: ctx.now() }), 8);
  const signals = Object.fromEntries(hits.map(h => [`${h.meta.id}#${h.chunk.section}`, { bm25: Math.round(h.bm25 * 100) / 100, cosine: Math.round(h.cosine * 100) / 100 }]));
  return { caller: caller ?? { id: 'anonymous', role: answer.role }, answer, signals, indexed: { documents: ctx.index.docs.size, chunks: ctx.index.chunks.length } };
}

export function readAudit(ctx: Context, limit: number): Array<Record<string, unknown>> {
  if (!ctx.auditLog || !existsSync(ctx.auditLog)) return [];
  return readFileSync(ctx.auditLog, 'utf8').split('\n').filter(Boolean).slice(-limit).map(l => { try { return JSON.parse(l); } catch { return { raw: 'unreadable line' }; } }).reverse();
}

export const INSPECTOR_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Context Inspector</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--ink:#1c2230;--mut:#5c6678;--line:#dde1e8;--acc:#2f5bd8;--ok:#13795b;--okbg:#e3f4ee;--warn:#946200;--warnbg:#fff3d6;--bad:#b3261e;--badbg:#fde8e6;--info:#33507a;--infobg:#e6edf8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:#1c2230;color:#fff;padding:14px 28px;display:flex;align-items:center;gap:16px}
header h1{font-size:17px;margin:0;font-weight:650}header .tag{font-size:12px;background:#2d3650;border-radius:10px;padding:2px 10px;color:#c5cde0}
header .who{margin-left:auto;font-size:13px;color:#c5cde0}header .who b{color:#fff}
main{max-width:1180px;margin:0 auto;padding:20px 28px 40px}
.bar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
input,select,button{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)}
input.q{flex:1;min-width:320px}button{background:var(--acc);color:#fff;border-color:var(--acc);cursor:pointer}button.alt{background:#fff;color:var(--acc)}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin-bottom:14px}
.card h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:0 0 10px}
.chip{display:inline-block;border-radius:10px;padding:1px 9px;font-size:12px;font-weight:600;white-space:nowrap}
.ok{background:var(--okbg);color:var(--ok)}.warn{background:var(--warnbg);color:var(--warn)}.bad{background:var(--badbg);color:var(--bad)}.info{background:var(--infobg);color:var(--info)}.none{background:#eceef2;color:var(--mut)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--mut);font-weight:600}
td.snip{color:#2b3346;max-width:380px}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}code{font:12.5px ui-monospace,Menlo,Consolas,monospace}
.conf{border-left:4px solid var(--warn);background:var(--warnbg);padding:10px 12px;border-radius:4px;margin-bottom:8px}.conf.sup{border-color:var(--info);background:var(--infobg)}
.ev{margin:6px 0 0;padding-left:0;list-style:none}.ev li{margin:4px 0}.ev q{color:#2b3346}
.status{font-size:15px;font-weight:650}.muted{color:var(--mut)}.err{color:var(--bad)}
#key{-webkit-text-security:disc}
</style></head><body>
<header><h1>Context Inspector</h1><span class="tag">read-only</span><span class="who" id="who"></span></header>
<main>
<div class="bar">
<input class="q" id="q" placeholder="Ask a question about internal knowledge" aria-label="Question">
<select id="role" aria-label="Role (local mode only)"></select>
<input id="key" type="text" placeholder="caller key" size="22" aria-label="Caller key" style="display:none">
<button id="go">Inspect</button>
</div>
<div class="bar"><input id="doc" placeholder="Fetch a document by id, e.g. hr-compensation-bands" size="46" aria-label="Document id"><button class="alt" id="fetchdoc">Fetch document</button></div>
<div id="out"></div>
<div class="card"><h2>Audit log (latest first)</h2><div id="audit" class="muted">Loading...</div></div>
</main>
<script>
const $ = id => document.getElementById(id);
const ROLES = ['employee','platform','payments','growth','data','finance-systems','security','hr','finance','admin'];
$('role').innerHTML = ROLES.map(r => '<option>' + r + '</option>').join('');
const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
if (params.get('role')) $('role').value = params.get('role');
if (params.get('q')) $('q').value = params.get('q');
if (params.get('doc')) $('doc').value = params.get('doc');
if (hash.get('key')) $('key').value = hash.get('key');
let authMode = false;
function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function chip(text, kind) { return h('span', 'chip ' + kind, text); }
const FRESH = { fresh: 'ok', aging: 'warn', stale: 'bad' }, CONF = { high: 'ok', medium: 'warn', low: 'bad' }, STAT = { active: 'ok', superseded: 'info' };
function headers() { const k = $('key').value.trim(); return k ? { Authorization: 'Bearer ' + k } : {}; }
async function api(path, init) {
  const r = await fetch(path, Object.assign({ headers: headers() }, init));
  return { status: r.status, body: await r.json() };
}
function renderAnswer(d) {
  const out = $('out'); out.textContent = '';
  const a = d.answer;
  const c = h('div', 'card'); c.appendChild(h('h2', '', 'Answer'));
  const kind = a.status === 'answered' ? 'ok' : a.status === 'answered_with_conflict' ? 'warn' : 'bad';
  const s = h('div'); s.appendChild(h('span', 'status', ''));
  s.appendChild(chip(a.status.replace(/_/g, ' '), kind));
  s.appendChild(document.createTextNode('  as role '));
  s.appendChild(h('code', '', a.role));
  c.appendChild(s);
  c.appendChild(h('p', a.answer ? '' : 'muted', a.answer || a.answer_note || (a.warnings && a.warnings[0]) || ''));
  out.appendChild(c);
  if (a.sources.length) {
    const sc = h('div', 'card'); sc.appendChild(h('h2', '', 'Retrieved sources'));
    const t = h('table'); const hd = h('tr');
    ['#','Document','Source','Updated','Flags','Confidence','Score (bm25 / cosine)','Snippet'].forEach(x => hd.appendChild(h('th', '', x))); t.appendChild(hd);
    for (const s of a.sources) {
      const tr = h('tr');
      tr.appendChild(h('td', '', s.ref));
      const td = h('td'); td.appendChild(h('code', '', s.doc_id)); td.appendChild(h('div', 'muted', s.section)); tr.appendChild(td);
      const tt = h('td'); tt.appendChild(chip(s.type, 'none')); tr.appendChild(tt);
      tr.appendChild(h('td', 'num', s.last_updated + ' (' + s.age_days + 'd)'));
      const f = h('td'); f.appendChild(chip(s.freshness, FRESH[s.freshness])); f.appendChild(document.createTextNode(' '));
      f.appendChild(chip(s.status, STAT[s.status] || 'none'));
      if (s.in_conflict) { f.appendChild(document.createTextNode(' ')); f.appendChild(chip('in conflict', 'warn')); }
      tr.appendChild(f);
      const cf = h('td'); cf.appendChild(chip(s.confidence, CONF[s.confidence])); tr.appendChild(cf);
      const sg = d.signals[s.doc_id + '#' + s.section] || {};
      tr.appendChild(h('td', 'num', s.score + '  (' + (sg.bm25 ?? '-') + ' / ' + (sg.cosine ?? '-') + ')'));
      tr.appendChild(h('td', 'snip', s.snippet));
      t.appendChild(tr);
    }
    sc.appendChild(t); out.appendChild(sc);
  }
  if (a.conflicts.length || a.warnings.length) {
    const cc = h('div', 'card'); cc.appendChild(h('h2', '', 'Conflicts and warnings'));
    for (const k of a.conflicts) {
      const b = h('div', 'conf' + (k.kind === 'superseded' ? ' sup' : ''));
      b.appendChild(chip(k.kind.replace(/_/g, ' '), k.kind === 'superseded' ? 'info' : 'warn'));
      b.appendChild(document.createTextNode('  ' + k.note));
      const ev = h('ul', 'ev');
      for (const e of (k.claim_evidence || [])) { const li = h('li'); li.appendChild(h('code', '', e.doc_id)); li.appendChild(document.createTextNode(' says ')); li.appendChild(h('b', '', e.claim)); li.appendChild(document.createTextNode(': ')); li.appendChild(h('q', '', e.sentence)); ev.appendChild(li); }
      if (ev.children.length) b.appendChild(ev);
      cc.appendChild(b);
    }
    for (const w of a.warnings) cc.appendChild(h('div', 'muted', w));
    out.appendChild(cc);
  }
}
async function run() {
  const q = $('q').value.trim(); if (q.length < 3) return;
  const role = authMode ? '' : '&role=' + encodeURIComponent($('role').value);
  const r = await api('/inspect?q=' + encodeURIComponent(q) + role);
  if (r.status !== 200) { $('out').textContent = ''; $('out').appendChild(h('div', 'card err', r.body.error ? r.body.error.message : 'Request failed')); }
  else { renderAnswer(r.body); $('who').textContent = ''; $('who').append('caller ', Object.assign(h('b'), { textContent: r.body.caller.id }), ' / role ', Object.assign(h('b'), { textContent: r.body.caller.role }), '  |  ' + r.body.indexed.documents + ' documents, ' + r.body.indexed.chunks + ' sections'); }
  await audit();
}
async function fetchDoc() {
  const id = $('doc').value.trim(); if (!id) return;
  const role = authMode ? {} : { role: $('role').value };
  const r = await api('/call', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers()), body: JSON.stringify({ tool: 'get_document', arguments: Object.assign({ doc_id: id }, role) }) });
  const out = $('out'); out.textContent = '';
  const c = h('div', 'card'); c.appendChild(h('h2', '', 'get_document ' + id));
  if (r.status === 200) { c.appendChild(chip('readable', 'ok')); const p = h('p'); p.textContent = r.body.result.title + ' (' + r.body.result.last_updated + ')'; c.appendChild(p); c.appendChild(h('div', 'muted', r.body.result.content.slice(0, 400))); }
  else { c.appendChild(chip('HTTP ' + r.status + ' ' + (r.body.error ? r.body.error.code : ''), 'bad')); c.appendChild(h('p', '', r.body.error ? r.body.error.message : '')); c.appendChild(h('div', 'muted', 'A restricted document answers exactly like a missing one, so its existence is not revealed.')); }
  out.appendChild(c); await audit();
}
async function audit() {
  const r = await api('/audit?limit=12'); const box = $('audit'); box.textContent = '';
  if (r.status !== 200) { box.textContent = r.status === 403 ? 'The audit log is visible to admin callers only.' : 'Audit log unavailable.'; return; }
  if (!r.body.entries.length) { box.textContent = 'No calls recorded yet.'; return; }
  const t = h('table'); const hd = h('tr'); ['Time (UTC)','Caller','Role','Tool','Outcome','Documents served'].forEach(x => hd.appendChild(h('th', '', x))); t.appendChild(hd);
  for (const e of r.body.entries) {
    const tr = h('tr'); tr.appendChild(h('td', 'num', String(e.ts).slice(11, 19))); tr.appendChild(h('td', '', e.caller)); tr.appendChild(h('td', '', e.role)); tr.appendChild(h('td', '', e.tool));
    const o = h('td'); o.appendChild(chip(e.outcome, e.outcome === 'ok' ? 'ok' : 'bad')); tr.appendChild(o);
    tr.appendChild(h('td', '', (e.doc_ids || []).join(', ') || '-')); t.appendChild(tr);
  }
  box.appendChild(t);
}
$('go').onclick = run; $('fetchdoc').onclick = fetchDoc; $('q').onkeydown = e => { if (e.key === 'Enter') run(); };
(async () => {
  const cfg = await api('/inspector/config'); authMode = cfg.body.auth;
  $('role').style.display = authMode ? 'none' : ''; $('key').style.display = authMode ? '' : 'none';
  if (params.get('doc')) await fetchDoc(); else if (params.get('q')) await run(); else await audit();
})();
</script></body></html>`;
