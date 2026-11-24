import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { Context, callTool, listTools } from './tools.js';
import { errorPayload } from './mcp.js';
import { Caller, IdentityStore } from './identity.js';
import { INSPECTOR_HTML, inspect, readAudit } from './inspector.js';
import { ROLES, Role, ToolError } from './types.js';

const STATUS: Record<string, number> = { INVALID_ARGUMENTS: 400, PERMISSION_DENIED: 403, NOT_FOUND: 404, UNKNOWN_TOOL: 404 };
const MAX_BODY = 64 * 1024;

export interface HttpOptions {
  /**
   * Per-caller identities. When set, every route except /health and the inspector page needs
   * "Authorization: Bearer <caller key>", and the caller's role comes from the identity config.
   * When unset (local development only) the role is taken from the request.
   */
  identities?: IdentityStore;
  /** Serve the read-only context inspector at /inspector (and its /inspect and /audit routes). */
  inspector?: boolean;
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

/**
 * Tiny JSON endpoint for generic workflow tools:
 *   GET  /health            -> { ok: true }
 *   GET  /tools             -> tool names, descriptions, JSON Schemas
 *   POST /call              -> { "tool": "...", "arguments": {...} }
 * and, with `inspector: true`: GET /inspector, /inspector/config, /inspect?q=, /audit?limit= (admin).
 */
export function createHttpServer(ctx: Context, opts: HttpOptions = {}): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (opts.inspector && req.method === 'GET' && url.pathname === '/inspector') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" });
        return void res.end(INSPECTOR_HTML);
      }
      if (opts.inspector && req.method === 'GET' && url.pathname === '/inspector/config') return send(res, 200, { auth: !!opts.identities });

      let caller: Caller | undefined;
      if (opts.identities) {
        caller = opts.identities.authenticate(req.headers.authorization) ?? undefined;
        if (!caller) return send(res, 401, { error: { code: 'UNAUTHENTICATED', message: 'Missing or unknown caller key.' } });
      }
      if (req.method === 'GET' && url.pathname === '/tools') return send(res, 200, { tools: listTools() });
      if (opts.inspector && req.method === 'GET' && url.pathname === '/inspect') {
        const role = url.searchParams.get('role') as Role | null;
        if (role && !ROLES.includes(role)) throw new ToolError('INVALID_ARGUMENTS', `Unknown role "${role}".`);
        return send(res, 200, inspect(ctx, caller, role ?? undefined, url.searchParams.get('q') ?? ''));
      }
      if (opts.inspector && req.method === 'GET' && url.pathname === '/audit') {
        if (caller && caller.role !== 'admin') return send(res, 403, { error: { code: 'PERMISSION_DENIED', message: 'The audit log is visible to admin callers only.' } });
        return send(res, 200, { entries: readAudit(ctx, Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, 100)) });
      }
      if (req.method === 'POST' && url.pathname === '/call') {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new ToolError('INVALID_ARGUMENTS', 'Content-Type must be application/json.');
        let body: { tool?: unknown; arguments?: unknown };
        try { body = JSON.parse(await readBody(req)); } catch (e) { if (e instanceof ToolError) throw e; throw new ToolError('INVALID_ARGUMENTS', 'Body is not valid JSON.'); }
        if (!body || typeof body !== 'object' || typeof body.tool !== 'string') throw new ToolError('INVALID_ARGUMENTS', 'Body must be {"tool": string, "arguments": object}.');
        return send(res, 200, { ok: true, result: callTool(ctx, body.tool, body.arguments, caller) });
      }
      return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown route.' } });
    } catch (e) {
      const payload = errorPayload(e);
      send(res, e instanceof ToolError ? STATUS[e.code] ?? 400 : 500, { ok: false, ...payload });
    }
  });
}
