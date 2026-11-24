// HTML renderers for the documentation pages (MCP transcript replay, evaluation table). Pure functions: data in, HTML out.
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const BASE_CSS = `
:root{--bg:#f4f5f7;--ink:#1c2230;--mut:#5c6678;--line:#dde1e8;--acc:#2f5bd8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:#1c2230;color:#fff;padding:14px 28px;font-weight:650;font-size:17px;display:flex;gap:14px;align-items:center}
header .tag{font-size:12px;background:#2d3650;border-radius:10px;padding:2px 10px;color:#c5cde0;font-weight:500}
main{padding:22px 28px 30px}`;

export function evalPage(report, meta) {
  const pct = x => x.toFixed(3);
  const row = (name, m, strong) => `<tr class="${strong ? 'strong' : ''}"><td>${esc(name)}</td><td class="n">${m.n}</td>${['hit@1', 'hit@3', 'hit@5', 'mrr'].map(k => `<td class="n"><div class="bar"><i style="width:${Math.round(m[k] * 100)}%"></i></div>${pct(m[k])}</td>`).join('')}</tr>`;
  const head = '<tr><th>Mode</th><th>Questions</th><th>hit@1</th><th>hit@3</th><th>hit@5</th><th>MRR</th></tr>';
  const sub = Object.entries(report.subsets).map(([k, v]) => row(k + ': BM25', v.bm25) + row(k + ': hybrid', v.hybrid, true)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Retrieval evaluation</title><style>${BASE_CSS}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-bottom:22px}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left}th{font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;background:#fafbfc}
td.n{font-variant-numeric:tabular-nums;white-space:nowrap}.bar{display:inline-block;width:90px;height:8px;background:#e8ebf1;border-radius:4px;margin-right:8px;vertical-align:middle}.bar i{display:block;height:100%;background:var(--acc);border-radius:4px}
tr.strong td:first-child{font-weight:650}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:0 0 8px}
.kpis{display:flex;gap:14px;margin-bottom:20px}.kpi{background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px 16px;min-width:150px}.kpi b{font-size:24px;display:block}.kpi span{font-size:12px;color:var(--mut)}
.ok{color:#13795b}</style></head><body><header>Retrieval evaluation <span class="tag">${esc(meta.corpus)}</span></header><main>
<div class="kpis"><div class="kpi"><b>${report.questions}</b><span>labelled questions</span></div><div class="kpi"><b>${meta.documents}</b><span>documents, 4 connectors</span></div><div class="kpi"><b class="ok">${report.leaks} / ${report.leak_checks}</b><span>permission leaks / checks</span></div><div class="kpi"><b>${pct(report.modes.hybrid['hit@1'])}</b><span>hybrid hit@1 (BM25 ${pct(report.modes.bm25['hit@1'])})</span></div></div>
<h2>All questions</h2><table>${head}${row('BM25 only', report.modes.bm25)}${row('Embedding only', report.modes.embedding)}${row('Hybrid (default)', report.modes.hybrid, true)}</table>
<h2>By subset (dev split was used to choose ranking settings; test split was not)</h2><table>${head}${sub}</table>
</main></body></html>`;
}

/** steps: [{ title, request, response, error }]. Shows everything; the recorder drives window.setProgress(p) frame by frame. */
export function transcriptPage(steps) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>MCP client session</title><style>${BASE_CSS}
.step{background:#fff;border:1px solid var(--line);border-radius:8px;margin-bottom:16px;overflow:hidden}.step h3{margin:0;padding:9px 14px;font-size:13px;background:#fafbfc;border-bottom:1px solid var(--line)}
.cols{display:grid;grid-template-columns:5fr 7fr}.pane{padding:10px 14px;min-height:60px}.pane+.pane{border-left:1px solid var(--line)}
.lbl{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--mut);margin-bottom:4px}
pre{margin:0;font:12.5px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.err .lbl{color:#b3261e}.k{color:#2f5bd8}.s{color:#13795b}.n{color:#946200}.hide{display:none}
.cur::after{content:"";display:inline-block;width:7px;height:14px;background:#2f5bd8;vertical-align:-2px;margin-left:1px;animation:b 1s steps(1) infinite}@keyframes b{50%{opacity:0}}
</style></head><body><header>MCP client session <span class="tag">stdio, caller agent-support (role employee)</span></header><main id="m"></main>
<script>
const steps = ${JSON.stringify(steps).replace(/</g, '\u003c')};
const hl = t => t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/("[^"]+")(:)/g,'<span class="k">$1</span>$2').replace(/: ("[^"]*")/g,': <span class="s">$1</span>').replace(/: (-?\d[\d.]*|true|false|null)/g,': <span class="n">$1</span>');
const m = document.getElementById('m');
// p: integer part = step index; fraction < 0.4 types the request, the rest reveals the response. No p (or p >= steps) shows everything.
function render(p) {
  m.textContent = '';
  steps.forEach((s, i) => {
    if (i > p) return;
    const f = i < Math.floor(p) ? 2 : p - i;
    const reqT = JSON.stringify(s.request, null, 2), resT = JSON.stringify(s.response, null, 2);
    const reqN = f >= 0.4 ? reqT.length : Math.round(reqT.length * f / 0.4);
    const lines = resT.split(String.fromCharCode(10));
    const resN = f < 0.4 ? 0 : Math.min(lines.length, Math.ceil(lines.length * (f - 0.4) / 0.5));
    const d = document.createElement('div'); d.className = 'step' + (s.error ? ' err' : '');
    d.innerHTML = '<h3></h3><div class="cols"><div class="pane"><div class="lbl">tools/call request</div><pre class="rq"></pre></div><div class="pane"><div class="lbl">' + (s.error ? 'tool error (isError: true)' : 'result') + '</div><pre class="rs"></pre></div></div>';
    d.querySelector('h3').textContent = s.title;
    d.querySelector('.rq').innerHTML = hl(reqT.slice(0, reqN));
    d.querySelector('.rs').innerHTML = hl(lines.slice(0, resN).join(String.fromCharCode(10)));
    m.appendChild(d);
  });
}
window.setProgress = render;
const q = new URLSearchParams(location.search).get('p');
render(q === null ? 99 : Number(q));
</script></body></html>`;
}
