import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Context, callTool, listTools } from './tools.js';
import { errorPayload } from './mcp.js';
import { ToolError } from './types.js';

const STATUS: Record<string, number> = { INVALID_ARGUMENTS: 400, PERMISSION_DENIED: 403, NOT_FOUND: 404, UNKNOWN_TOOL: 404 };
const MAX_BODY = 64 * 1024;

export interface HttpOptions {
  /** Shared bearer credential. Required when binding to anything other than loopback. */
  auth?: string;
}

function send(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new ToolError('INVALID_ARGUMENTS', `Request body exceeds ${MAX_BODY} bytes.`)); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

function authorised(req: IncomingMessage, expected?: string): boolean {
  if (!expected) return true;
  const got = Buffer.from(String(req.headers.authorization ?? ''));
  const want = Buffer.from(`Bearer ${expected}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Tiny JSON endpoint for generic workflow tools:
 *   GET  /health            -> { ok: true }
 *   GET  /tools             -> tool names, descriptions, JSON Schemas
 *   POST /call              -> { "tool": "...", "arguments": {...} }
 */
export function createHttpServer(ctx: Context, opts: HttpOptions = {}): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (!authorised(req, opts.auth)) return send(res, 401, { error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid bearer credential.' } });
      if (req.method === 'GET' && url.pathname === '/tools') return send(res, 200, { tools: listTools() });
      if (req.method === 'POST' && url.pathname === '/call') {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new ToolError('INVALID_ARGUMENTS', 'Content-Type must be application/json.');
        let body: { tool?: unknown; arguments?: unknown };
        try { body = JSON.parse(await readBody(req)); } catch (e) { if (e instanceof ToolError) throw e; throw new ToolError('INVALID_ARGUMENTS', 'Body is not valid JSON.'); }
        if (!body || typeof body !== 'object' || typeof body.tool !== 'string') throw new ToolError('INVALID_ARGUMENTS', 'Body must be {"tool": string, "arguments": object}.');
        return send(res, 200, { ok: true, result: callTool(ctx, body.tool, body.arguments) });
      }
      return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown route.' } });
    } catch (e) {
      const payload = errorPayload(e);
      send(res, e instanceof ToolError ? STATUS[e.code] ?? 400 : 500, { ok: false, ...payload });
    }
  });
}
