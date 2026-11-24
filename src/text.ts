// Text analysis and a small hashed "embedding". No external model, no network.
const STOP = new Set(('a an and are as at be by for from has have how i if in is it its of on or our that the their there this to was we what when where which who why will with you your do does can should must not no than then so any all each per up out about into over after before between during within without').split(' '));

export function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ied')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && w.endsWith('es') && /(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ion')) w = w.slice(0, -3);
  if (w.length > 5 && w.endsWith('ly')) w = w.slice(0, -2);
  return w;
}

export function analyze(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

export function termFreq(terms: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of terms) tf[t] = (tf[t] ?? 0) + 1;
  return tf;
}

// Small hand-written concept lexicon: words in a group share a concept feature in the
// embedding. This is the "semantic" part of the hybrid and is intentionally tiny and inspectable.
const CONCEPTS: string[][] = [
  ['incident', 'outage', 'down', 'sev', 'pager', 'page', 'paged', 'alert', 'emergency'],
  ['oncall', 'pager', 'carrying', 'rotation', 'primary', 'secondary', 'acknowledge', 'escalate', 'escalation', 'unacknowledged'],
  ['timeoff', 'pto', 'vacation', 'leave', 'holiday', 'absence', 'closure', 'floating', 'recovery', 'compensatory'],
  ['pay', 'salary', 'compensation', 'band', 'offer', 'wage'],
  ['expense', 'reimburse', 'receipt', 'travel', 'hotel', 'flight', 'meal', 'spend'],
  ['access', 'vpn', 'proxy', 'zero', 'trust', 'dashboard', 'session', 'login'],
  ['equipment', 'laptop', 'monitor', 'screen', 'display', 'device', 'stipend'],
  ['queue', 'broker', 'streaming', 'async', 'job', 'consumer', 'dead', 'letter'],
  ['deploy', 'release', 'ship', 'rollout', 'rollback', 'friday'],
  ['owner', 'own', 'responsible', 'maintain', 'steward', 'team'],
  ['security', 'lost', 'stolen', 'phishing', 'mfa', 'multi', 'factor', 'credential', 'leak', 'breach', 'pentest', 'vulnerability'],
  ['database', 'postgres', 'db', 'failover', 'replica', 'replication', 'datastore'],
  ['certificate', 'tls', 'ssl', 'cert', 'expiry'],
  ['review', 'approve', 'approval', 'reviewer'],
  ['onboarding', 'newcomer', 'joiner', 'first', 'week', 'buddy'],
  ['fraud', 'risk', 'decline', 'chargeback'],
  ['remote', 'wfh', 'home', 'abroad', 'overseas', 'foreign', 'country'],
  ['lost', 'stolen', 'theft', 'missing', 'misplaced'],
  ['duplicate', 'twice', 'double', 'resend', 'copies', 'copy'],
  ['late', 'lag', 'delay', 'behind', 'slow', 'spike', 'latency'],
  ['fix', 'resolve', 'workaround', 'mitigation', 'patch', 'cause'],
  ['wipe', 'reset', 'refresh', 'purge'],
].map(g => g.map(stem));
const CONCEPT_OF = new Map<string, number[]>();
CONCEPTS.forEach((g, i) => g.forEach(w => CONCEPT_OF.set(w, [...(CONCEPT_OF.get(w) ?? []), i])));

const DIM = 1024;
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export type SparseVec = Array<[number, number]>;

export function embed(terms: string[]): SparseVec {
  const acc = new Map<number, number>();
  const add = (feat: string, w: number) => {
    const h = hash(feat);
    const idx = h % DIM;
    const sign = (h >>> 16) & 1 ? 1 : -1;
    acc.set(idx, (acc.get(idx) ?? 0) + sign * w);
  };
  const tf = termFreq(terms);
  for (const [t, c] of Object.entries(tf)) {
    const w = 1 + Math.log(c);
    add('w:' + t, w);
    const padded = `^${t}$`;
    for (let i = 0; i + 3 <= padded.length; i++) add('c:' + padded.slice(i, i + 3), 0.25 * w);
    for (const g of CONCEPT_OF.get(t) ?? []) add('k:' + g, 1.5 * w);
  }
  let norm = 0;
  for (const v of acc.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return [...acc.entries()].map(([i, v]): [number, number] => [i, Math.round((v / norm) * 1e5) / 1e5]);
}

export function cosine(a: SparseVec, b: Map<number, number>): number {
  let s = 0;
  for (const [i, v] of a) s += v * (b.get(i) ?? 0);
  return s;
}
