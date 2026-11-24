import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { CONNECTORS, SOURCE_FILE, parseCsv } from './connectors.js';
import { Chunk, Claim, IndexedDoc } from './types.js';

const CACHE_VERSION = 3;

interface CacheEntry { mtimeMs: number; size: number; sha: string; connector?: string; docs: IndexedDoc[] }
interface CacheFile { version: number; files: Record<string, CacheEntry> }

export interface ReindexReport {
  added: string[]; changed: string[]; removed: string[]; unchanged: number; parsed: number; docs: number; chunks: number;
  by_connector: Record<string, number>; // documents per connector after this run
}

export interface OwnershipRow { service: string; owning_team: string; oncall_alias: string; channel: string; tier: string; updated: string }

export interface IndexedClaim { docId: string; section: string; claim: Claim }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SOURCE_FILE.test(name)) out.push(p);
  }
  return out;
}

export class ContextIndex {
  private files: Record<string, CacheEntry> = {};
  docs = new Map<string, IndexedDoc>();
  // BM25 corpus statistics, rebuilt after every reindex (cheap: counts only).
  df: Record<string, number> = {};
  avgLen = 1;
  chunks: Chunk[] = [];
  claims: IndexedClaim[] = [];

  constructor(public root: string, public cacheFile?: string) {
    if (cacheFile && existsSync(cacheFile)) {
      try {
        const c = JSON.parse(readFileSync(cacheFile, 'utf8')) as CacheFile;
        if (c.version === CACHE_VERSION) this.files = c.files;
      } catch { /* corrupt cache: rebuild from scratch */ }
    }
    this.rebuild();
  }

  /** Incremental: stat fast-path, then content hash; only changed files are re-parsed and re-embedded. */
  reindex(): ReindexReport {
    const report: ReindexReport = { added: [], changed: [], removed: [], unchanged: 0, parsed: 0, docs: 0, chunks: 0, by_connector: {} };
    const seen = new Set<string>();
    for (const abs of walk(this.root)) {
      const rel = relative(this.root, abs).split('\\').join('/');
      seen.add(rel);
      const st = statSync(abs);
      const prev = this.files[rel];
      if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) { report.unchanged++; continue; }
      const raw = readFileSync(abs, 'utf8');
      const sha = createHash('sha256').update(raw).digest('hex');
      if (prev && prev.sha === sha) { prev.mtimeMs = st.mtimeMs; prev.size = st.size; report.unchanged++; continue; }
      const connector = CONNECTORS.find(c => c.accepts(rel));
      let docs: IndexedDoc[] = [];
      try { docs = connector ? connector.parse(rel, raw) : []; } catch { docs = []; }
      this.files[rel] = { mtimeMs: st.mtimeMs, size: st.size, sha, connector: connector?.name, docs };
      report.parsed++;
      (prev ? report.changed : report.added).push(rel);
    }
    for (const rel of Object.keys(this.files)) {
      if (!seen.has(rel)) { delete this.files[rel]; report.removed.push(rel); }
    }
    this.rebuild();
    report.docs = this.docs.size;
    report.chunks = this.chunks.length;
    for (const e of Object.values(this.files)) if (e.connector) report.by_connector[e.connector] = (report.by_connector[e.connector] ?? 0) + e.docs.length;
    if (this.cacheFile && (report.added.length || report.changed.length || report.removed.length || !existsSync(this.cacheFile))) {
      mkdirSync(dirname(this.cacheFile), { recursive: true });
      writeFileSync(this.cacheFile, JSON.stringify({ version: CACHE_VERSION, files: this.files } satisfies CacheFile));
    }
    return report;
  }

  private rebuild(): void {
    this.docs = new Map();
    for (const e of Object.values(this.files)) for (const d of e.docs) this.docs.set(d.meta.id, d);
    this.chunks = [...this.docs.values()].flatMap(d => d.chunks);
    this.claims = this.chunks.flatMap(c => (c.claims ?? []).map(claim => ({ docId: c.docId, section: c.section, claim })));
    this.df = {};
    let total = 0;
    for (const c of this.chunks) {
      total += c.len;
      for (const t of Object.keys(c.terms)) this.df[t] = (this.df[t] ?? 0) + 1;
    }
    this.avgLen = this.chunks.length ? total / this.chunks.length : 1;
  }

  ownershipRows(): OwnershipRow[] {
    if (!this.files['ownership/services.csv']) return [];
    return parseCsv(readFileSync(join(this.root, 'ownership/services.csv'), 'utf8')) as unknown as OwnershipRow[];
  }

  teamDirectory(): Array<{ team: string; lead: string; channel: string }> {
    if (!this.files['ownership/teams.json']) return [];
    return (JSON.parse(readFileSync(join(this.root, 'ownership/teams.json'), 'utf8')) as { teams: Array<{ team: string; lead: string; channel: string }> }).teams;
  }
}
