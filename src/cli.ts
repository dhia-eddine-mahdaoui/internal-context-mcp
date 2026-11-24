#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ContextIndex } from './index.js';
import { createContext, callTool, listTools } from './tools.js';
import { createMcpServer, errorPayload } from './mcp.js';
import { createHttpServer } from './http.js';
import { loadQuestions, runEval } from './eval.js';
import { ROLES, Role } from './types.js';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parse(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
    } else pos.push(a);
  }
  return { pos, flags };
}

const HELP = `context-mcp <command> [options]

Commands
  mcp                          run the MCP server over stdio
  serve-http                   run the JSON endpoint (--port 8787 --host localhost)
  reindex [--watch]            incremental re-index (--watch polls for changes)
  tools                        print tool names and schemas
  call <tool> '<json args>'    call a tool once and print the result
  search "<query>"             shortcut for search_context
  eval                         run the labelled question set (hit@k per mode)

Options
  --kb <dir>      knowledge base directory (env CONTEXT_KB_DIR, default ./kb)
  --cache <file>  index cache file (env CONTEXT_CACHE, default ./.context-index/index.json)
  --role <role>   caller role; on mcp/serve-http this LOCKS the role (env CONTEXT_CALLER_ROLE)
  --audit <file>  append a JSON line per call (env CONTEXT_AUDIT_LOG)
  --now <date>    reference date for freshness (env CONTEXT_NOW), for reproducible runs

Roles: ${ROLES.join(', ')}
HTTP: set CONTEXT_HTTP_AUTH to require "Authorization: Bearer <value>" (mandatory off loopback).`;

async function main() {
  const { pos, flags } = parse(process.argv.slice(2));
  const cmd = pos[0];
  if (!cmd || cmd === 'help' || flags.help) { console.log(HELP); return; }
  const kb = resolve(flags.kb ?? process.env.CONTEXT_KB_DIR ?? 'kb');
  const cache = resolve(flags.cache ?? process.env.CONTEXT_CACHE ?? '.context-index/index.json');
  const roleArg = flags.role ?? process.env.CONTEXT_CALLER_ROLE;
  if (roleArg && !ROLES.includes(roleArg as Role)) throw new Error(`Unknown role "${roleArg}". Use one of: ${ROLES.join(', ')}`);
  const nowStr = flags.now ?? process.env.CONTEXT_NOW;
  const now = () => (nowStr ? new Date(nowStr) : new Date());
  const index = new ContextIndex(kb, cache);
  const mk = (locked: boolean) => createContext(index, { now, auditLog: flags.audit ?? process.env.CONTEXT_AUDIT_LOG, ...(locked && roleArg ? { lockedRole: roleArg as Role } : { defaultRole: (roleArg as Role) ?? 'employee' }) });

  switch (cmd) {
    case 'mcp': {
      index.reindex();
      const server = createMcpServer(mk(true));
      await server.connect(new StdioServerTransport());
      console.error(`context-mcp: serving ${index.docs.size} documents over stdio`);
      return;
    }
    case 'serve-http': {
      index.reindex();
      const host = flags.host ?? 'localhost';
      const port = Number(flags.port ?? 8787);
      const auth = process.env.CONTEXT_HTTP_AUTH;
      if (!['localhost', '::1'].includes(host) && !host.startsWith('127.') && !auth) throw new Error('Refusing to bind a non-loopback host without CONTEXT_HTTP_AUTH set.');
      const server = createHttpServer(mk(true), { auth });
      server.listen(port, host, () => console.error(`context-mcp: http endpoint on ${host}:${port} (${index.docs.size} documents)`));
      return;
    }
    case 'reindex': {
      const show = () => console.log(JSON.stringify(index.reindex()));
      show();
      if (flags.watch) setInterval(() => { const r = index.reindex(); if (r.added.length || r.changed.length || r.removed.length) console.log(JSON.stringify(r)); }, Number(flags.interval ?? 2000));
      return;
    }
    case 'tools':
      console.log(JSON.stringify(listTools(), null, 2));
      return;
    case 'call':
    case 'search': {
      index.reindex();
      const ctx = mk(false);
      const [tool, args] = cmd === 'search' ? ['search_context', JSON.stringify({ query: pos[1] ?? '' })] : [pos[1], pos[2] ?? '{}'];
      try { console.log(JSON.stringify(callTool(ctx, tool, JSON.parse(args)), null, 2)); }
      catch (e) { console.log(JSON.stringify(errorPayload(e), null, 2)); process.exitCode = 1; }
      return;
    }
    case 'eval': {
      index.reindex();
      const questions = loadQuestions(resolve(flags.questions ?? join(pkgRoot, 'eval', 'questions.json')));
      const report = runEval(index, questions, nowStr ? new Date(nowStr) : new Date('2026-11-01'));
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    default:
      console.error(`Unknown command "${cmd}"\n`);
      console.error(HELP);
      process.exitCode = 2;
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
