import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.js';
import { createHttpServer } from '../src/http.js';
import { IdentityStore, generateIdentities } from '../src/identity.js';
import { makeContext } from './helpers.js';

test('mcp: tools list, a valid call, and a rejected call over a real client/server pair', async () => {
  const ctx = makeContext();
  const server = createMcpServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['answer_with_sources', 'get_document', 'reindex', 'search_context', 'who_owns']);
  const ok = await client.callTool({ name: 'who_owns', arguments: { service: 'payments-ledger' } });
  assert.ok(!ok.isError);
  assert.equal(JSON.parse((ok.content as Array<{ text: string }>)[0].text).owning_team, 'payments');
  const bad = await client.callTool({ name: 'search_context', arguments: { query: 'pto', k: -1, bogus: true } });
  assert.equal(bad.isError, true);
  const payload = JSON.parse((bad.content as Array<{ text: string }>)[0].text);
  assert.equal(payload.error.code, 'INVALID_ARGUMENTS');
  assert.match(payload.error.message, /unknown field/);
  await client.close();
});

async function listen(identities?: IdentityStore, inspector = false) {
  const server = createHttpServer(makeContext(), { identities, inspector });
  server.listen(0, 'localhost');
  await once(server, 'listening');
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  return { server, base };
}
const post = (base: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + '/call', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('http: call, schema rejection (400), permission (404 for hidden docs), unknown tool, bad body', async () => {
  const { server, base } = await listen();
  try {
    const ok = await post(base, { tool: 'answer_with_sources', arguments: { question: 'How many days of paid time off do I get?' } });
    assert.equal(ok.status, 200);
    const body = await ok.json() as { ok: boolean; result: { status: string; sources: Array<{ doc_id: string }> } };
    assert.equal(body.result.status, 'answered');
    assert.equal(body.result.sources[0].doc_id, 'hb-pto');
    assert.equal((await post(base, { tool: 'search_context', arguments: { query: 'x' } })).status, 400);
    assert.equal((await post(base, { tool: 'get_document', arguments: { doc_id: 'hr-compensation-bands' } })).status, 404);
    assert.equal((await post(base, { tool: 'reindex', arguments: { role: 'employee' } })).status, 403);
    assert.equal((await post(base, { tool: 'missing' })).status, 404);
    assert.equal((await post(base, '{not json')).status, 400);
    assert.equal((await fetch(base + '/tools')).status, 200);
    assert.equal((await fetch(base + '/health')).status, 200);
  } finally { server.closeAllConnections(); server.close(); }
});

test('http: per-caller keys map to roles; a role argument cannot widen them', async () => {
  const { config, keys } = generateIdentities([{ id: 'agent-a', role: 'employee' }, { id: 'agent-hr', role: 'hr' }, { id: 'ops', role: 'admin' }]);
  const { server, base } = await listen(new IdentityStore(config), true);
  const as = (id: string) => ({ Authorization: `Bearer ${keys[id]}` });
  const doc = { tool: 'get_document', arguments: { doc_id: 'hr-compensation-bands' } };
  try {
    assert.equal((await post(base, doc)).status, 401);
    assert.equal((await post(base, doc, { Authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await post(base, doc, as('agent-a'))).status, 404);
    assert.equal((await post(base, doc, as('agent-hr'))).status, 200);
    assert.equal((await post(base, { tool: 'get_document', arguments: { doc_id: 'hr-compensation-bands', role: 'hr' } }, as('agent-a'))).status, 403);
    assert.equal((await post(base, { tool: 'reindex', arguments: {} }, as('agent-hr'))).status, 403);
    assert.equal((await post(base, { tool: 'reindex', arguments: {} }, as('ops'))).status, 200);
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/audit')).status, 401);
    assert.equal((await fetch(base + '/audit', { headers: as('agent-a') })).status, 403);
    assert.equal((await fetch(base + '/audit', { headers: as('ops') })).status, 200);
    assert.match(await (await fetch(base + '/inspector')).text(), /Context Inspector/);
    const r = await fetch(base + '/inspect?q=' + encodeURIComponent('who owns the billing api'), { headers: as('agent-a') });
    assert.equal(((await r.json()) as { caller: { id: string } }).caller.id, 'agent-a');
  } finally { server.closeAllConnections(); server.close(); }
});

test('mcp: a bound caller cannot override its role', async () => {
  const { config } = generateIdentities([{ id: 'agent-a', role: 'employee' }]);
  const caller = new IdentityStore(config).byId('agent-a')!;
  const server = createMcpServer(makeContext(), caller);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const res = await client.callTool({ name: 'get_document', arguments: { doc_id: 'hr-compensation-bands', role: 'hr' } });
  assert.equal(res.isError, true);
  assert.match((res.content as Array<{ text: string }>)[0].text, /PERMISSION_DENIED/);
  await client.close();
});
