import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parseFrontMatter, splitSections } from './frontmatter.js';
import { analyze, embed, termFreq } from './text.js';
import { Chunk, DOC_TYPES, DocMeta, DocType, IndexedDoc } from './types.js';

const CACHE_VERSION = 2;

interface CacheEntry { mtimeMs: number; size: number; sha: string; docs: IndexedDoc[] }
interface CacheFile { version: number; files: Record<string, CacheEntry> }

export interface ReindexReport {
  added: string[]; changed: string[]; removed: string[]; unchanged: number; parsed: number; docs: number; chunks: number;
}

export interface OwnershipRow { service: string; owning_team: string; oncall_alias: string; channel: string; tier: string; updated: string }

function chunkDoc(meta: DocMeta, sections: Array<{ heading: string; text: string }>): Chunk[] {
  return sections.map(s => {
    const terms = analyze(`${meta.title} ${meta.title} ${s.heading} ${s.text}`);
    return { docId: meta.id, section: s.heading, text: s.text, terms: termFreq(terms), len: terms.length, vec: embed(terms) };
  });
}

function parseMarkdown(rel: string, raw: string): IndexedDoc[] {
  const { meta, body } = parseFrontMatter(raw);
  const id = String(meta.id ?? '');
  if (!id) return [];
  const type = String(meta.type ?? 'handbook') as DocType;
  const m: DocMeta = {
    id, title: String(meta.title ?? id), type: DOC_TYPES.includes(type) ? type : 'handbook',
    updated: String(meta.updated ?? '1970-01-01'), status: meta.status === 'superseded' ? 'superseded' : 'active',
    superseded_by: meta.superseded_by ? String(meta.superseded_by) : undefined,
    restricted_to: Array.isArray(meta.restricted_to) ? meta.restricted_to : undefined,
    owner: meta.owner ? String(meta.owner) : undefined,
    service: meta.service ? String(meta.service) : undefined,
    topic: meta.topic ? String(meta.topic) : undefined,
    path: rel,
  };
  return [{ meta: m, body, chunks: chunkDoc(m, splitSections(body, m.title)) }];
}

export function parseCsv(raw: string): Record<string, string>[] {
  const [head, ...rows] = raw.split(/\r?\n/).filter(l => l.trim());
  const cols = head.split(',').map(c => c.trim());
  return rows.map(r => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v.trim()])));
}

function parseOwnership(rel: string, raw: string): IndexedDoc[] {
  if (rel.endsWith('.csv')) {
    const rows = parseCsv(raw) as unknown as OwnershipRow[];
    const updated = rows.map(r => r.updated).sort().pop() ?? '1970-01-01';
    const meta: DocMeta = { id: 'ownership-services', title: 'Service ownership table', type: 'ownership', updated, status: 'active', topic: 'ownership', path: rel };
    const sections = rows.map(r => ({ heading: r.service, text: `Service ${r.service} is owned by the ${r.owning_team} team. On-call alias ${r.oncall_alias}, channel ${r.channel}, tier ${r.tier}. Row updated ${r.updated}.` }));
    return [{ meta, body: raw, chunks: chunkDoc(meta, sections) }];
  }
  const data = JSON.parse(raw) as { updated: string; teams: Array<{ team: string; lead: string; channel: string }> };
  const meta: DocMeta = { id: 'ownership-teams', title: 'Team directory', type: 'ownership', updated: data.updated, status: 'active', topic: 'ownership-teams', path: rel };
  const sections = data.teams.map(t => ({ heading: t.team, text: `Team ${t.team} is led by ${t.lead}. Channel ${t.channel}.` }));
  return [{ meta, body: raw, chunks: chunkDoc(meta, sections) }];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(md|csv|json)$/.test(name)) out.push(p);
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
    const report: ReindexReport = { added: [], changed: [], removed: [], unchanged: 0, parsed: 0, docs: 0, chunks: 0 };
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
      let docs: IndexedDoc[] = [];
      try { docs = rel.startsWith('ownership/') ? parseOwnership(rel, raw) : rel.endsWith('.md') ? parseMarkdown(rel, raw) : []; } catch { docs = []; }
      this.files[rel] = { mtimeMs: st.mtimeMs, size: st.size, sha, docs };
      report.parsed++;
      (prev ? report.changed : report.added).push(rel);
    }
    for (const rel of Object.keys(this.files)) {
      if (!seen.has(rel)) { delete this.files[rel]; report.removed.push(rel); }
    }
    this.rebuild();
    report.docs = this.docs.size;
    report.chunks = this.chunks.length;
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
