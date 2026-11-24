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
}

export interface EvalReport {
  questions: number;
  modes: Record<Mode, { 'hit@1': number; 'hit@3': number; 'hit@5': number; mrr: number }>;
  leaks: number;
  misses: Array<{ q: string; mode: Mode; got: string[] }>;
}

export function loadQuestions(path: string): EvalQuestion[] {
  return JSON.parse(readFileSync(path, 'utf8')) as EvalQuestion[];
}

export function runEval(index: ContextIndex, questions: EvalQuestion[], now: Date): EvalReport {
  const modes: Mode[] = ['bm25', 'embedding', 'hybrid'];
  const scored = questions.filter(q => q.expect.length > 0);
  const report: EvalReport = { questions: scored.length, modes: {} as EvalReport['modes'], leaks: 0, misses: [] };
  for (const mode of modes) {
    let h1 = 0, h3 = 0, h5 = 0, rr = 0;
    for (const q of questions) {
      const ranked = topDocs(searchChunks(index, q.q, { role: q.role, mode, now }), 10).map(h => h.meta.id);
      if (mode === 'hybrid' && q.forbid?.some(f => ranked.includes(f))) report.leaks++;
      if (!q.expect.length) continue;
      const rank = ranked.findIndex(id => q.expect.includes(id));
      if (rank === 0) h1++;
      if (rank >= 0 && rank < 3) h3++;
      if (rank >= 0 && rank < 5) h5++;
      if (rank >= 0) rr += 1 / (rank + 1);
      if (rank < 0 || rank >= 3) report.misses.push({ q: q.q, mode, got: ranked.slice(0, 3) });
    }
    const n = scored.length;
    const r = (x: number) => Math.round((x / n) * 1000) / 1000;
    report.modes[mode] = { 'hit@1': r(h1), 'hit@3': r(h3), 'hit@5': r(h5), mrr: r(rr) };
  }
  return report;
}
