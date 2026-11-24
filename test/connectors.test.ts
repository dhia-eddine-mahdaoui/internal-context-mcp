import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContextIndex } from '../src/index.js';
import { call, callError, makeContext, tempKb, NOW } from './helpers.js';
import { createContext } from '../src/tools.js';

test('connectors: markdown, tickets, chat and ownership are all indexed with their own ACLs', () => {
  const ctx = makeContext();
  const bySource = new Map<string, number>();
  for (const d of ctx.index.docs.values()) bySource.set(d.meta.source ?? '?', (bySource.get(d.meta.source ?? '?') ?? 0) + 1);
  assert.ok((bySource.get('ticket') ?? 0) >= 10 && (bySource.get('chat') ?? 0) >= 10 && (bySource.get('markdown') ?? 0) >= 41);
  assert.equal(callError(ctx, 'get_document', { doc_id: 'tkt-pay-77', role: 'employee' }).code, 'NOT_FOUND');
  assert.equal(call(ctx, 'get_document', { doc_id: 'tkt-pay-77', role: 'payments' }).doc_id, 'tkt-pay-77');
  assert.equal(callError(ctx, 'get_document', { doc_id: 'chat-security-private-t1', role: 'payments' }).code, 'NOT_FOUND');
  const hit = call(ctx, 'search_context', { query: 'leaked credential rotated again keep details in channel', role: 'employee' });
  assert.ok(!hit.results.some((r: { doc_id: string }) => r.doc_id.startsWith('chat-security')));
});

test('connectors: a ticket closed as duplicate is flagged superseded', () => {
  const ctx = makeContext();
  const d = call(ctx, 'get_document', { doc_id: 'tkt-plat-198' });
  assert.equal(d.status, 'superseded');
  assert.equal(d.superseded_by, 'tkt-plat-176');
});

test('connectors: a new chat message and ticket file are picked up incrementally', () => {
  const dir = tempKb();
  const index = new ContextIndex(dir);
  index.reindex();
  appendFileSync(join(dir, 'chat', 'random.jsonl'), JSON.stringify({ ts: '2026-10-30T10:00:00Z', user: 'kim', thread: 't9', text: 'The office plant watering rota moved to Thursdays.' }) + '\n');
  const r = index.reindex();
  assert.deepEqual(r.changed, ['chat/random.jsonl']);
  assert.equal(r.parsed, 1);
  assert.ok(index.docs.has('chat-random-t9'));
  writeFileSync(join(dir, 'tickets', 'new.json'), JSON.stringify({ project: 'NEW', tickets: [{ key: 'NEW-1', title: 'Plant rota', status: 'open', updated: '2026-10-30', description: 'Rota.' }] }));
  assert.deepEqual(index.reindex().added, ['tickets/new.json']);
  assert.ok(index.docs.has('tkt-new-1'));
});

test('conflicts: differing numeric claims across ticket and runbook are detected from text', () => {
  const ctx = makeContext();
  const a = call(ctx, 'answer_with_sources', { question: 'How many days before expiry do public certificates rotate?', max_sources: 4 });
  assert.equal(a.status, 'answered_with_conflict');
  const c = a.conflicts.find((x: { kind: string }) => x.kind === 'claim_mismatch');
  assert.ok(c, 'expected a claim_mismatch conflict');
  assert.deepEqual(c.documents.map((d: { doc_id: string }) => d.doc_id).sort(), ['rb-certificate-rotation', 'tkt-plat-230']);
  assert.match(JSON.stringify(c.claim_evidence), /30 days/);
  assert.match(JSON.stringify(c.claim_evidence), /21 days/);
});

test('conflicts: text claims never reveal a restricted document', () => {
  const dir = tempKb();
  writeFileSync(join(dir, 'chat', 'x.jsonl'), [{ channel: '#x', restricted_to: ['security'] }, { ts: '2026-10-30T10:00:00Z', user: 'a', thread: 't', text: 'Public certificates rotate automatically 5 days before expiry for the public edge.' }].map(l => JSON.stringify(l)).join('\n') + '\n');
  const index = new ContextIndex(dir); index.reindex();
  const ctx = createContext(index, { now: () => NOW, refreshMs: Infinity });
  const a = call(ctx, 'answer_with_sources', { question: 'How many days before expiry do public certificates rotate?', role: 'employee', max_sources: 4 });
  assert.ok(!/5 days before expiry/.test(JSON.stringify(a)));
});
