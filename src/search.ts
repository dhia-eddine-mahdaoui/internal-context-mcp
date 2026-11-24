import { ContextIndex } from './index.js';
import { ageDays, canRead, freshness } from './policy.js';
import { analyze, cosine, embed } from './text.js';
import { Chunk, DocMeta, DocType, Freshness, Role, SourceKind } from './types.js';

export type Mode = 'hybrid' | 'bm25' | 'embedding';

export interface Hit {
  chunk: Chunk;
  meta: DocMeta;
  bm25: number;      // fraction of the best attainable BM25 score for this query (0..1+)
  cosine: number;    // cosine similarity of hashed embeddings
  relevance: number; // mode-specific blend, before status/freshness adjustment
  score: number;     // ranking score after adjustments
  freshness: Freshness;
  age_days: number;
}

/** Ranking knobs. Defaults are what the server uses; the eval harness varies them on the dev split only. */
export interface Tuning {
  bm25Weight: number;
  /** 'minmax' scales each signal by its best value among this caller's candidates before blending, so neither signal dominates by scale. */
  fusion: 'linear' | 'minmax';
  /** Multiplier by source connector: informal chat and tickets rank below authored pages when relevance is similar. */
  sourcePrior: Partial<Record<SourceKind, number>>;
}
export const DEFAULT_TUNING: Tuning = { bm25Weight: 0.55, fusion: 'linear', sourcePrior: { chat: 0.7, ticket: 0.85 } };

export interface SearchOptions {
  tuning?: Partial<Tuning>;
  role: Role;
  mode?: Mode;
  includeSuperseded?: boolean;
  types?: DocType[];
  now: Date;
}

const K1 = 1.4, B = 0.75;
export const BM25_WEIGHT = 0.55;
const STATUS_FACTOR = { active: 1, superseded: 0.5 } as const;
const FRESH_FACTOR = { fresh: 1, aging: 0.97, stale: 0.92 } as const;

/** Permission filtering happens BEFORE scoring: restricted chunks never enter ranking for a caller without access. */
export function searchChunks(index: ContextIndex, query: string, opts: SearchOptions): Hit[] {
  const mode = opts.mode ?? 'hybrid';
  const tune: Tuning = { ...DEFAULT_TUNING, ...opts.tuning };
  const qTerms = [...new Set(analyze(query))];
  if (qTerms.length === 0) return [];
  const N = index.chunks.length;
  const idf = (t: string) => Math.log(1 + (N - (index.df[t] ?? 0) + 0.5) / ((index.df[t] ?? 0) + 0.5));
  const maxBm25 = qTerms.reduce((s, t) => s + idf(t) * (K1 + 1), 0) || 1;
  const qVec = new Map(embed(analyze(query)));
  const hits: Hit[] = [];
  for (const doc of index.docs.values()) {
    const meta = doc.meta;
    if (!canRead(meta, opts.role)) continue;
    if (opts.includeSuperseded === false && meta.status === 'superseded') continue;
    if (opts.types && !opts.types.includes(meta.type)) continue;
    const fresh = freshness(meta.updated, opts.now);
    for (const chunk of doc.chunks) {
      let raw = 0;
      for (const t of qTerms) {
        const tf = chunk.terms[t];
        if (!tf) continue;
        raw += idf(t) * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * chunk.len / index.avgLen));
      }
      const bm25 = raw / maxBm25;
      const cos = Math.max(0, cosine(chunk.vec, qVec));
      const relevance = mode === 'bm25' ? bm25 : mode === 'embedding' ? cos : tune.bm25Weight * bm25 + (1 - tune.bm25Weight) * cos;
      if (relevance <= 0) continue;
      hits.push({
        chunk, meta, bm25, cosine: cos, relevance,
        score: relevance * STATUS_FACTOR[meta.status] * FRESH_FACTOR[fresh] * (tune.sourcePrior[meta.source ?? 'markdown'] ?? 1),
        freshness: fresh, age_days: ageDays(meta.updated, opts.now),
      });
    }
  }
  if (mode === 'hybrid' && tune.fusion === 'minmax' && hits.length) {
    const mb = Math.max(...hits.map(h => h.bm25)) || 1, mc = Math.max(...hits.map(h => h.cosine)) || 1;
    for (const h of hits) {
      const fused = tune.bm25Weight * (h.bm25 / mb) + (1 - tune.bm25Weight) * (h.cosine / mc);
      h.score = fused * STATUS_FACTOR[h.meta.status] * FRESH_FACTOR[h.freshness] * (tune.sourcePrior[h.meta.source ?? 'markdown'] ?? 1);
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.chunk.docId.localeCompare(b.chunk.docId));
}

/** Collapse chunk hits into at most `perDoc` chunks per document, keeping rank order. */
export function topDocs(hits: Hit[], k: number, perDoc = 1): Hit[] {
  const counts = new Map<string, number>();
  const out: Hit[] = [];
  for (const h of hits) {
    const c = counts.get(h.chunk.docId) ?? 0;
    if (c >= perDoc) continue;
    counts.set(h.chunk.docId, c + 1);
    out.push(h);
    if (out.length >= k) break;
  }
  return out;
}

/** Extractive snippet: the 1-2 sentences of a chunk that share the most terms with the query. */
export function snippet(text: string, query: string, max = 320): string {
  const q = new Set(analyze(query));
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  const scored = sentences.map((s, i) => ({ s, i, n: analyze(s).filter(t => q.has(t)).length }));
  const best = [...scored].sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 2).filter(x => x.n > 0 || scored.length === 1);
  const picked = (best.length ? best : scored.slice(0, 1)).sort((a, b) => a.i - b.i).map(x => x.s).join(' ');
  return picked.length > max ? picked.slice(0, max - 1) + '…' : picked;
}
