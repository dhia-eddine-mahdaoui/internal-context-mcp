import test from 'node:test';
import assert from 'node:assert/strict';
import { call, callError, makeContext } from './helpers.js';

const ctx = makeContext();
const ids = (r: { results: Array<{ doc_id: string }> }) => r.results.map(x => x.doc_id);

test('schema: invalid calls are rejected with every problem listed', () => {
  assert.equal(callError(ctx, 'nope', {}).code, 'UNKNOWN_TOOL');
  assert.equal(callError(ctx, 'search_context', {}).code, 'INVALID_ARGUMENTS');
  assert.match(callError(ctx, 'search_context', {}).message, /arguments\.query: required/);
  assert.match(callError(ctx, 'search_context', { query: 42 }).message, /expected a string/);
  assert.match(callError(ctx, 'search_context', { query: 'x' }).message, /at least 2 characters/);
  assert.match(callError(ctx, 'search_context', { query: 'pto', k: 500 }).message, /must be <= 20/);
  assert.match(callError(ctx, 'search_context', { query: 'pto', k: 1.5 }).message, /expected an integer/);
  assert.match(callError(ctx, 'search_context', { query: 'pto', role: 'root' }).message, /must be one of/);
  assert.match(callError(ctx, 'search_context', { query: 'pto', surprise: 1 }).message, /unknown field/);
  assert.match(callError(ctx, 'search_context', { query: 'pto', doc_types: ['handbook', 'handbook'] }).message, /unique/);
  assert.match(callError(ctx, 'get_document', { doc_id: '../../etc/passwd' }).message, /format/);
  assert.match(callError(ctx, 'search_context', { query: 'a\u0000b' }).message, /control characters/);
  assert.match(callError(ctx, 'search_context', 'not an object').message, /expected an object/);
  const many = callError(ctx, 'search_context', { k: 0, role: 'x', extra: true });
  assert.equal((many.details as { errors: string[] }).errors.length, 4); // missing query, k, role, extra
});

test('permissions: restricted docs are invisible to callers without the team role', () => {
  const salary = 'What is the salary band for a level 4 engineer?';
  const asEmployee = call(ctx, 'search_context', { query: salary, role: 'employee', k: 20 });
  assert.ok(!ids(asEmployee).includes('hr-compensation-bands'));
  assert.ok(!JSON.stringify(asEmployee).includes('90000'), 'restricted content must not leak into any field');
  assert.ok(ids(call(ctx, 'search_context', { query: salary, role: 'hr' })).includes('hr-compensation-bands'));
  assert.ok(ids(call(ctx, 'search_context', { query: salary, role: 'admin' })).includes('hr-compensation-bands'));
  assert.ok(!ids(call(ctx, 'search_context', { query: salary, role: 'security', k: 20 })).includes('hr-compensation-bands'));
});

test('permissions: get_document on a restricted doc looks exactly like a missing doc', () => {
  const denied = callError(ctx, 'get_document', { doc_id: 'hr-compensation-bands', role: 'employee' });
  const missing = callError(ctx, 'get_document', { doc_id: 'hr-compensation-bandz', role: 'employee' });
  assert.equal(denied.code, 'NOT_FOUND');
  assert.equal(denied.message.replace('hr-compensation-bands', 'X'), missing.message.replace('hr-compensation-bandz', 'X'));
  assert.match(call(ctx, 'get_document', { doc_id: 'hr-compensation-bands', role: 'hr' }).content, /band/);
});

test('permissions: answer_with_sources abstains instead of leaking restricted content', () => {
  const r = call(ctx, 'answer_with_sources', { question: 'How much runway does the company have at the current burn rate?', role: 'employee' });
  assert.ok(!JSON.stringify(r).includes('30 months'));
  assert.ok(!r.sources.some((s: { doc_id: string }) => s.doc_id === 'fin-board-financials-q3'));
});

test('permissions: a deployment-locked role cannot be overridden; reindex needs admin', () => {
  const locked = makeContext(undefined, { lockedRole: 'employee' });
  assert.equal(callError(locked, 'search_context', { query: 'salary band', role: 'admin' }).code, 'PERMISSION_DENIED');
  assert.ok(!ids(call(locked, 'search_context', { query: 'salary band level 4' })).includes('hr-compensation-bands'));
  assert.equal(callError(ctx, 'reindex', { role: 'employee' }).code, 'PERMISSION_DENIED');
});

test('conflicts: two active docs that disagree are both surfaced and no single answer is asserted', () => {
  const r = call(ctx, 'answer_with_sources', { question: 'How long until an unacknowledged page escalates to the secondary on-call?' });
  assert.equal(r.status, 'answered_with_conflict');
  assert.equal(r.answer, null);
  const c = r.conflicts.find((x: { kind: string }) => x.kind === 'active_disagreement');
  assert.ok(c, 'expected an active_disagreement conflict');
  const claims = Object.fromEntries(c.claims.map((x: { doc_id: string; snippet: string }) => [x.doc_id, x.snippet]));
  assert.match(claims['hb-oncall-policy'], /30 minutes/);
  assert.match(claims['rb-incident-response'], /15 minutes/);
  assert.ok(r.sources.some((s: { in_conflict?: boolean }) => s.in_conflict));
});

test('conflicts: superseded docs are demoted, flagged, and never presented as current', () => {
  const r = call(ctx, 'search_context', { query: 'VPN access policy for engineers', k: 5 });
  const order = ids(r);
  assert.ok(order.indexOf('hb-vpn-2025') < order.indexOf('hb-vpn-2023'));
  const old = r.results.find((x: { doc_id: string }) => x.doc_id === 'hb-vpn-2023');
  assert.equal(old.status, 'superseded');
  assert.equal(old.superseded_by, 'hb-vpn-2025');
  assert.equal(old.confidence, 'low');
  assert.ok(r.conflicts.some((c: { kind: string }) => c.kind === 'superseded'));
  const answer = call(ctx, 'answer_with_sources', { question: 'Do I need the VPN to reach internal dashboards?' });
  assert.equal(answer.sources[0].doc_id, 'hb-vpn-2025');
  assert.match(answer.answer, /access proxy|VPN/);
  const hidden = call(ctx, 'search_context', { query: 'VPN access policy for engineers', include_superseded: false });
  assert.ok(!ids(hidden).includes('hb-vpn-2023'));
});

test('freshness: stale documents carry a flag and a warning', () => {
  const r = call(ctx, 'answer_with_sources', { question: 'How do I reserve the staging environment?' });
  const s = r.sources.find((x: { doc_id: string }) => x.doc_id === 'hb-staging-guide');
  assert.equal(s.freshness, 'stale');
  assert.notEqual(s.confidence, 'high');
  assert.ok(r.warnings.some((w: string) => /hb-staging-guide/.test(w)));
  assert.match(s.last_updated, /^2022-03-14$/);
});

test('answer_with_sources abstains on off-topic questions', () => {
  const r = call(ctx, 'answer_with_sources', { question: 'What is the weather forecast for tomorrow in Lisbon?' });
  assert.equal(r.status, 'insufficient_evidence');
  assert.equal(r.answer, null);
  assert.deepEqual(r.sources, []);
});

test('who_owns: answers from the ownership table and flags a disagreeing service doc', () => {
  const ok = call(ctx, 'who_owns', { service: 'billing-api' });
  assert.equal(ok.owning_team, 'payments');
  assert.equal(ok.source.doc_id, 'ownership-services');
  assert.equal(ok.conflicts.length, 0);
  const bad = call(ctx, 'who_owns', { service: 'notification-svc' });
  assert.equal(bad.owning_team, 'growth');
  assert.equal(bad.conflicts[0].claimed_owner, 'platform');
  assert.equal(bad.confidence, 'medium');
  const missing = callError(ctx, 'who_owns', { service: 'billing' });
  assert.equal(missing.code, 'NOT_FOUND');
  assert.ok((missing.details as { suggestions: string[] }).suggestions.includes('billing-api'));
});
