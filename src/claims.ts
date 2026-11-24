// Numeric claim extraction for text-based conflict detection (durations and percentages).
import { analyze } from './text.js';
import { Claim } from './types.js';

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, sixty: 60 };
const TIME_MIN: Record<string, number> = { minute: 1, min: 1, hour: 60, hr: 60, day: 1440, week: 10080, month: 43200 };
const CLAIM_RE = new RegExp(`\\b(\\d+(?:\\.\\d+)?|${Object.keys(NUM_WORDS).join('|')})[- ]?(?:(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)|(%|percent))`, 'gi');

/** Cheap suffix folding on top of the analyzer's stems so acknowledge / acknowledged / acknowledges meet. */
const undouble = (x: string) => (x.length > 1 && x[x.length - 1] === x[x.length - 2] ? x.slice(0, -1) : x);
const root = (t: string) => (t.length > 4 ? undouble(t.replace(/(es|e|s)$/, '')) : t);

/** Find duration / percentage claims. The sentence's other words become the claim's "subject". */
export function extractClaims(text: string): Claim[] {
  const out: Claim[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean)) {
    for (const m of sentence.matchAll(CLAIM_RE)) {
      const n = /^\d/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1].toLowerCase()];
      if (!Number.isFinite(n)) continue;
      const terms = [...new Set(analyze(sentence.replace(m[0], ' ')).filter(t => !/^\d+$/.test(t)).map(root))];
      if (m[3]) out.push({ dim: 'percent', value: n, shown: m[0], sentence, terms });
      else {
        const unit = m[2].toLowerCase().replace(/s$/, '');
        out.push({ dim: 'time', value: n * (TIME_MIN[unit] ?? 1), shown: m[0], sentence, terms });
      }
    }
  }
  return out;
}

/** Two claims disagree when they measure the same thing (same dimension, enough shared subject words) with different values. */
export function claimsDisagree(a: Claim, b: Claim): boolean {
  if (a.dim !== b.dim || Math.abs(a.value - b.value) < 1e-9) return false;
  const sb = new Set(b.terms);
  const shared = a.terms.filter(t => sb.has(t)).length;
  const smaller = Math.min(a.terms.length, b.terms.length);
  // overlap coefficient: a short, specific sentence ("Submit receipts within 30 days") can match a longer chat message about the same thing
  return shared >= Math.min(3, smaller) && smaller > 0 && shared / smaller >= 0.6;
}
