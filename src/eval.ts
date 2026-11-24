import { readFileSync } from 'node:fs';
import { ContextIndex } from './index.js';
import { Mode, searchChunks, topDocs } from './search.js';
import { Role } from './types.js';

export interface EvalQuestion {
  q: string;
  role: Role;
  /** Any of these doc ids appearing in the top k counts as a hit. */
  expect: string[];
  /** Doc ids that must NEVER appear for this role (permission leak check). */
  forbid?: string[];
  tag?: string;
  /** dev: used to choose ranking settings; test: never used for tuning. */
  split?: 'dev' | 'test';
}

export interface Metrics { n: number; 'hit@1': number; 'hit@3': number; 'hit@5': number; mrr: number }

export interface EvalReport {
  questions: number;
  modes: Record<Mode, Metrics>;
  /** Hybrid and BM25 per subset (split, and questions answered by tickets / chat). */
  subsets: Record<string, { bm25: Metrics; hybrid: Metrics }>;
  leaks: number;
  leak_checks: number;
  misses: Array<{ q: string; mode: Mode; got: string[] }>;
}

export function loadQuestions(path: string): EvalQuestion[] {
  return JSON.parse(readFileSync(path, 'utf8')) as EvalQuestion[];
}

function score(index: ContextIndex, qs: EvalQuestion[], mode: Mode, now: Date, misses?: EvalReport['misses']): Metrics {
  let h1 = 0, h3 = 0, h5 = 0, rr = 0;
  for (const q of qs) {
    const ranked = topDocs(searchChunks(index, q.q, { role: q.role, mode, now }), 10).map(h => h.meta.id);
    const rank = ranked.findIndex(id => q.expect.includes(id));
    if (rank === 0) h1++;
    if (rank >= 0 && rank < 3) h3++;
    if (rank >= 0 && rank < 5) h5++;
    if (rank >= 0) rr += 1 / (rank + 1);
    if (misses && (rank < 0 || rank >= 3)) misses.push({ q: q.q, mode, got: ranked.slice(0, 3) });
  }
  const n = qs.length || 1, r = (x: number) => Math.round((x / n) * 1000) / 1000;
  return { n: qs.length, 'hit@1': r(h1), 'hit@3': r(h3), 'hit@5': r(h5), mrr: r(rr) };
}

export function runEval(index: ContextIndex, questions: EvalQuestion[], now: Date): EvalReport {
  const scored = questions.filter(q => q.expect.length > 0);
  const report: EvalReport = { questions: scored.length, modes: {} as EvalReport['modes'], subsets: {}, leaks: 0, leak_checks: 0, misses: [] };
  for (const mode of ['bm25', 'embedding', 'hybrid'] as Mode[]) report.modes[mode] = score(index, scored, mode, now, report.misses);
  const subsets: Record<string, EvalQuestion[]> = {
    'dev split': scored.filter(q => q.split === 'dev'),
    'test split': scored.filter(q => q.split === 'test'),
    'ticket questions': scored.filter(q => q.tag === 'ticket'),
    'chat questions': scored.filter(q => q.tag === 'chat'),
    'paraphrases': scored.filter(q => q.tag === 'paraphrase' || q.tag === 'hard-paraphrase'),
  };
  for (const [name, qs] of Object.entries(subsets)) if (qs.length) report.subsets[name] = { bm25: score(index, qs, 'bm25', now), hybrid: score(index, qs, 'hybrid', now) };
  for (const q of questions.filter(x => x.forbid?.length)) {
    report.leak_checks++;
    const ranked = topDocs(searchChunks(index, q.q, { role: q.role, now }), 10).map(h => h.meta.id);
    if (q.forbid!.some(f => ranked.includes(f))) report.leaks++;
  }
  return report;
}
