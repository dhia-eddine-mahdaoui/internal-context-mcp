import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextIndex } from '../src/index.js';
import { call, callError, makeContext, tempKb } from './helpers.js';

test('reindex: first run adds everything, second run changes nothing', () => {
  const kb = tempKb();
  const index = new ContextIndex(kb);
  const first = index.reindex();
  assert.ok(first.added.length >= 40);
  assert.equal(first.parsed, first.added.length);
  const second = index.reindex();
  assert.deepEqual([second.added, second.changed, second.removed], [[], [], []]);
  assert.equal(second.parsed, 0);
  assert.equal(second.unchanged, first.added.length);
});

test('reindex: only the edited file is re-parsed, and new content becomes searchable', () => {
  const kb = tempKb();
  const ctx = makeContext(kb, { refreshMs: 0 });
  assert.equal(call(ctx, 'search_context', { query: 'quokka zanzibar' }).results.length, 0);
  appendFileSync(join(kb, 'handbook', 'hb-pto.md'), '\n## Quokka zanzibar\nTime off requests are paused during the quokka zanzibar freeze.\n');
  // refreshMs 0: the next call detects the change by itself (no explicit reindex)
  const r = call(ctx, 'search_context', { query: 'quokka zanzibar' });
  assert.equal(r.results[0].doc_id, 'hb-pto');
  assert.equal(r.results[0].section, 'Quokka zanzibar');
  const report = ctx.index.reindex();
  assert.equal(report.parsed, 0, 'already picked up; nothing left to do');
});

test('reindex: reports exactly which files were added, changed and removed', () => {
  const kb = tempKb();
  const index = new ContextIndex(kb);
  index.reindex();
  writeFileSync(join(kb, 'handbook', 'hb-new.md'), '---\nid: hb-new\ntitle: New page\ntype: handbook\nupdated: 2026-10-30\nstatus: active\n---\n# New page\n\n## Body\nHello there.\n');
  appendFileSync(join(kb, 'handbook', 'hb-pto.md'), '\nExtra line.\n');
  rmSync(join(kb, 'handbook', 'hb-holidays.md'));
  const r = index.reindex();
  assert.deepEqual(r.added, ['handbook/hb-new.md']);
  assert.deepEqual(r.changed, ['handbook/hb-pto.md']);
  assert.deepEqual(r.removed, ['handbook/hb-holidays.md']);
  assert.equal(r.parsed, 2);
  assert.ok(index.docs.has('hb-new') && !index.docs.has('hb-holidays'));
});

test('reindex: a touched-but-identical file is detected as unchanged by content hash', () => {
  const kb = tempKb();
  const index = new ContextIndex(kb);
  index.reindex();
  const p = join(kb, 'handbook', 'hb-pto.md');
  writeFileSync(p, readFileSync(p, 'utf8'));
  utimesSync(p, new Date(), new Date(Date.now() + 5000));
  const r = index.reindex();
  assert.equal(r.parsed, 0);
  assert.deepEqual(r.changed, []);
});

test('reindex: the persisted cache lets a fresh process skip unchanged files', () => {
  const kb = tempKb();
  const cacheDir = mkdtempSync(join(tmpdir(), 'ctx-cache-'));
  const cache = join(cacheDir, 'index.json');
  const a = new ContextIndex(kb, cache);
  assert.ok(a.reindex().parsed > 40);
  const b = new ContextIndex(kb, cache);
  const r = b.reindex();
  assert.equal(r.parsed, 0);
  assert.equal(b.docs.size, a.docs.size);
  appendFileSync(join(kb, 'runbooks', 'rb-billing-api.md'), '\nNote: new step.\n');
  assert.equal(new ContextIndex(kb, cache).reindex().parsed, 1);
});

test('reindex tool: admin only; the same request_id is not re-run, a reused id with other arguments is rejected', () => {
  const kb = tempKb();
  const ctx = makeContext(kb);
  appendFileSync(join(kb, 'handbook', 'hb-pto.md'), '\nMore text.\n');
  const first = call(ctx, 'reindex', { role: 'admin', request_id: 'retry-1' });
  assert.deepEqual(first.changed, ['handbook/hb-pto.md']);
  appendFileSync(join(kb, 'handbook', 'hb-expenses.md'), '\nMore text.\n');
  const retry = call(ctx, 'reindex', { role: 'admin', request_id: 'retry-1' });
  assert.equal(retry.deduplicated, true);
  assert.deepEqual(retry.changed, ['handbook/hb-pto.md']);
  assert.equal(callError(ctx, 'reindex', { role: 'employee', request_id: 'retry-1' }).code, 'PERMISSION_DENIED');
  assert.deepEqual(call(ctx, 'reindex', { role: 'admin' }).changed, ['handbook/hb-expenses.md']);
});
