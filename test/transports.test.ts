import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.js';
import { createHttpServer } from '../src/http.js';
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

async function listen(auth?: string) {
  const server = createHttpServer(makeContext(), { auth });
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

test('http: bearer credential is enforced when configured', async () => {
  const { server, base } = await listen('shared-value-123');
  try {
    assert.equal((await post(base, { tool: 'who_owns', arguments: { service: 'billing-api' } })).status, 401);
    assert.equal((await post(base, { tool: 'who_owns', arguments: { service: 'billing-api' } }, { Authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await post(base, { tool: 'who_owns', arguments: { service: 'billing-api' } }, { Authorization: 'Bearer shared-value-123' })).status, 200);
    assert.equal((await fetch(base + '/health')).status, 200);
  } finally { server.closeAllConnections(); server.close(); }
});
