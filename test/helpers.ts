import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContextIndex } from '../src/index.js';
import { Context, callTool, createContext } from '../src/tools.js';
import { ToolError } from '../src/types.js';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NOW = new Date('2026-11-01T00:00:00Z');

/** Copy the shipped KB into a throwaway directory so tests can edit files freely. */
export function tempKb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-kb-'));
  cpSync(join(repoRoot, 'kb'), dir, { recursive: true });
  return dir;
}

export function makeContext(kbDir = join(repoRoot, 'kb'), opts: Parameters<typeof createContext>[1] = {}): Context {
  const index = new ContextIndex(kbDir);
  index.reindex();
  return createContext(index, { now: () => NOW, refreshMs: Infinity, ...opts });
}

export function call<T = any>(ctx: Context, tool: string, args: unknown): T {
  return callTool(ctx, tool, args) as T;
}

export function callError(ctx: Context, tool: string, args: unknown): ToolError {
  try { callTool(ctx, tool, args); } catch (e) { if (e instanceof ToolError) return e; throw e; }
  throw new Error('expected the call to be rejected');
}
