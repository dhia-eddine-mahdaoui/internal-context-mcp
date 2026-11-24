import { claimsDisagree } from './claims.js';
import { ContextIndex } from './index.js';
import { Confidence, DocMeta, Freshness, Role } from './types.js';

/** A role may read a doc when it is unrestricted, the caller is admin, or the role is in restricted_to. */
export function canRead(meta: DocMeta, role: Role): boolean {
  if (!meta.restricted_to || meta.restricted_to.length === 0) return true;
  return role === 'admin' || meta.restricted_to.includes(role);
}

export const FRESH_DAYS = 180;
export const AGING_DAYS = 365;

export function ageDays(updated: string, now: Date): number {
  const t = Date.parse(updated);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 86400000)) : 99999;
}

export function freshness(updated: string, now: Date): Freshness {
  const a = ageDays(updated, now);
  return a <= FRESH_DAYS ? 'fresh' : a <= AGING_DAYS ? 'aging' : 'stale';
}

export function confidence(opts: { relevance: number; status: string; freshness: Freshness; conflicted: boolean }): Confidence {
  if (opts.status === 'superseded' || opts.relevance < 0.2) return 'low';
  if (opts.conflicted || opts.freshness === 'stale') return 'medium';
  return opts.relevance >= 0.3 ? 'high' : 'medium';
}

export interface Conflict {
  kind: 'active_disagreement' | 'superseded' | 'claim_mismatch';
  topic: string;
  documents: Array<{ doc_id: string; title: string; updated: string; status: string; superseded_by?: string }>;
  /** Text evidence: the differing numeric claims found in the documents themselves. */
  claim_evidence?: Array<{ doc_id: string; section: string; claim: string; sentence: string }>;
  note: string;
}

/**
 * Surface (never hide) disagreements for the docs a caller is about to see.
 * Only documents the caller may read take part, so a conflict never reveals a restricted doc.
 */
export function findConflicts(index: ContextIndex, role: Role, docIds: Iterable<string>): Conflict[] {
  const out: Conflict[] = [];
  const topics = new Set<string>();
  const seenSuperseded = new Set<string>();
  for (const id of docIds) {
    const m = index.docs.get(id)?.meta;
    if (!m || !canRead(m, role)) continue;
    if (m.topic) topics.add(m.topic);
    if (m.status === 'superseded' && !seenSuperseded.has(m.id)) {
      seenSuperseded.add(m.id);
      const succ = m.superseded_by ? index.docs.get(m.superseded_by)?.meta : undefined;
      out.push({
        kind: 'superseded', topic: m.topic ?? m.id,
        documents: [m, ...(succ && canRead(succ, role) ? [succ] : [])].map(brief),
        note: `${m.id} is marked superseded${succ && canRead(succ, role) ? `; prefer ${succ.id}` : ''}.`,
      });
    }
  }
  for (const topic of topics) {
    const active = [...index.docs.values()].map(d => d.meta).filter(m => m.topic === topic && m.status === 'active' && canRead(m, role));
    if (active.length >= 2) {
      const newest = [...active].sort((a, b) => b.updated.localeCompare(a.updated))[0];
      out.push({
        kind: 'active_disagreement', topic, documents: active.map(brief),
        note: `${active.length} active documents cover "${topic}" and may disagree. The most recently updated is ${newest.id} (${newest.updated}); verify with the owning team before acting.`,
      });
    }
  }
  out.push(...claimConflicts(index, role, [...docIds], out));
  return out;
}

const MAX_CLAIM_CONFLICTS = 3;

/**
 * Text-based detection: a numeric claim (duration / percentage) in a result document is compared with claims about the
 * same subject (shared words) in every other readable, active document, whatever its source or topic metadata.
 */
function claimConflicts(index: ContextIndex, role: Role, docIds: string[], existing: Conflict[]): Conflict[] {
  const out: Conflict[] = [];
  const seenPairs = new Set<string>();
  const readable = (id: string) => { const m = index.docs.get(id)?.meta; return !!m && m.status === 'active' && canRead(m, role); };
  for (const id of docIds) {
    if (!readable(id)) continue;
    for (const a of index.claims.filter(c => c.docId === id)) {
      for (const b of index.claims) {
        if (b.docId === id || !readable(b.docId) || !claimsDisagree(a.claim, b.claim)) continue;
        const pair = [a.docId, b.docId].sort().join('|');
        // one finding per (doc, claim, opposing value): eight docs repeating the same sentence are not eight conflicts
        const dedupe = `${a.docId}|${a.claim.shown}|${b.claim.shown}`;
        if (seenPairs.has(pair) || seenPairs.has(dedupe)) continue;
        seenPairs.add(pair); seenPairs.add(dedupe);
        const evidence = [a, b].map(x => ({ doc_id: x.docId, section: x.section, claim: x.claim.shown, sentence: x.claim.sentence }));
        const metas = [a.docId, b.docId].map(d => index.docs.get(d)!.meta);
        const topicConflict = existing.find(c => c.kind === 'active_disagreement' && metas.every(m => c.documents.some(d => d.doc_id === m.id)));
        if (topicConflict) { topicConflict.claim_evidence = evidence; continue; }
        const newest = [...metas].sort((x, y) => y.updated.localeCompare(x.updated))[0];
        const informal = metas.some(m => m.source === 'chat');
        out.push({
          kind: 'claim_mismatch', topic: `${a.claim.shown} vs ${b.claim.shown}`, documents: metas.map(brief), claim_evidence: evidence,
          note: `${a.docId} says "${a.claim.shown}" and ${b.docId} says "${b.claim.shown}" about the same subject. The more recently updated is ${newest.id} (${newest.updated})${informal ? ', but chat is informal and not a system of record' : ''}; verify with the owning team.`,
        });
      }
    }
  }
  return out.slice(0, MAX_CLAIM_CONFLICTS);
}

function brief(m: DocMeta) {
  return { doc_id: m.id, title: m.title, updated: m.updated, status: m.status, ...(m.superseded_by ? { superseded_by: m.superseded_by } : {}) };
}
