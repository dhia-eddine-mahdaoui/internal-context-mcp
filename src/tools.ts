import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ContextIndex, ReindexReport } from './index.js';
import { Conflict, canRead, confidence, findConflicts, freshness, ageDays } from './policy.js';
import { Hit, searchChunks, snippet, topDocs } from './search.js';
import { Schema, validate } from './validate.js';
import { DOC_TYPES, Role, ROLES, ToolError } from './types.js';
import { splitSections } from './frontmatter.js';

export interface Context {
  index: ContextIndex;
  now: () => Date;
  /** When set, the caller's role is fixed by the deployment (e.g. derived from the authenticated identity) and cannot be overridden by arguments. */
  lockedRole?: Role;
  defaultRole: Role;
  /** Minimum ms between automatic change scans before a call. 0 = scan on every call. */
  refreshMs: number;
  lastScan: number;
  auditLog?: string;
  dedupe: Map<string, { fingerprint: string; result: unknown }>;
}

export function createContext(index: ContextIndex, opts: Partial<Pick<Context, 'now' | 'lockedRole' | 'defaultRole' | 'refreshMs' | 'auditLog'>> = {}): Context {
  return {
    index, now: opts.now ?? (() => new Date()), lockedRole: opts.lockedRole,
    defaultRole: opts.lockedRole ?? opts.defaultRole ?? 'employee',
    refreshMs: opts.refreshMs ?? 2000, lastScan: 0, auditLog: opts.auditLog, dedupe: new Map(),
  };
}

const roleProp: Schema = { type: 'string', enum: ROLES, description: 'Caller role used for permission filtering. Ignored/rejected when the deployment locks the role.' };
const docId: Schema = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{2,80}$', description: 'Document id, e.g. rb-billing-api' };

interface Tool {
  name: string;
  description: string;
  inputSchema: Schema;
  readOnly: boolean;
  handler: (ctx: Context, args: any, role: Role) => unknown;
}

function noteConflicts(conflicts: Conflict[]) {
  return conflicts.length ? conflicts : undefined;
}

function resultDoc(h: Hit, query: string, conflictedTopics: Set<string>, ctx: Context) {
  const conflicted = !!h.meta.topic && conflictedTopics.has(h.meta.topic);
  return {
    doc_id: h.meta.id, title: h.meta.title, section: h.chunk.section, type: h.meta.type,
    snippet: snippet(h.chunk.text, query),
    last_updated: h.meta.updated, age_days: ageDays(h.meta.updated, ctx.now()),
    freshness: h.freshness, status: h.meta.status,
    ...(h.meta.superseded_by ? { superseded_by: h.meta.superseded_by } : {}),
    confidence: confidence({ relevance: h.relevance, status: h.meta.status, freshness: h.freshness, conflicted }),
    score: Math.round(h.score * 1000) / 1000,
    ...(conflicted ? { in_conflict: true } : {}),
  };
}

const MIN_RELEVANCE = 0.12;   // below this the top hit is not good enough to answer from
const MIN_HIT = 0.1;          // search_context drops hits below this (noise from the embedding side)
const MIN_SOURCE = 0.18;      // answer sources / conflict detection only consider reasonably relevant sections

const tools: Tool[] = [
  {
    name: 'search_context',
    description: 'Hybrid (BM25 + hashed embedding) search over internal documents the caller is allowed to read. Returns ranked sections with doc id, section, last-updated date, freshness and confidence. Superseded docs are demoted and flagged; disagreements are returned in `conflicts`.',
    readOnly: true,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['query'],
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 500 },
        k: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
        doc_types: { type: 'array', items: { type: 'string', enum: DOC_TYPES }, minItems: 1, maxItems: 6, uniqueItems: true },
        include_superseded: { type: 'boolean', default: true },
        role: roleProp,
      },
    },
    handler(ctx, a, role) {
      const hits = topDocs(searchChunks(ctx.index, a.query, { role, includeSuperseded: a.include_superseded, types: a.doc_types, now: ctx.now() }).filter(h => h.relevance >= MIN_HIT), a.k ?? 5);
      const conflicts = findConflicts(ctx.index, role, hits.filter(h => h.relevance >= MIN_SOURCE).map(h => h.meta.id));
      const topics = new Set(conflicts.filter(c => c.kind === 'active_disagreement').map(c => c.topic));
      return {
        query: a.query, role,
        results: hits.map(h => resultDoc(h, a.query, topics, ctx)),
        conflicts: conflicts,
        audit_doc_ids: hits.map(h => h.meta.id),
      };
    },
  },
  {
    name: 'get_document',
    description: 'Fetch one document (or one section) by id. Restricted documents the caller cannot read are reported as not found, indistinguishable from a missing id.',
    readOnly: true,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['doc_id'],
      properties: { doc_id: docId, section: { type: 'string', minLength: 1, maxLength: 200 }, role: roleProp },
    },
    handler(ctx, a, role) {
      const doc = ctx.index.docs.get(a.doc_id);
      if (!doc || !canRead(doc.meta, role)) throw new ToolError('NOT_FOUND', `No document "${a.doc_id}" is available to this caller.`);
      const sections = splitSections(doc.body, doc.meta.title);
      let content = doc.body.trim();
      if (a.section) {
        const s = sections.find(x => x.heading.toLowerCase() === String(a.section).toLowerCase());
        if (!s) throw new ToolError('NOT_FOUND', `Document "${a.doc_id}" has no section "${a.section}".`, { sections: sections.map(x => x.heading) });
        content = s.text;
      }
      const conflicts = findConflicts(ctx.index, role, [doc.meta.id]);
      return {
        doc_id: doc.meta.id, title: doc.meta.title, type: doc.meta.type, status: doc.meta.status,
        ...(doc.meta.superseded_by ? { superseded_by: doc.meta.superseded_by } : {}),
        last_updated: doc.meta.updated, freshness: freshness(doc.meta.updated, ctx.now()),
        owner: doc.meta.owner ?? null, sections: sections.map(s => s.heading), content,
        warnings: [
          ...(doc.meta.status === 'superseded' ? [`This document is superseded${doc.meta.superseded_by ? ` by ${doc.meta.superseded_by}` : ''}.`] : []),
          ...(freshness(doc.meta.updated, ctx.now()) === 'stale' ? [`Not updated for ${ageDays(doc.meta.updated, ctx.now())} days; verify before relying on it.`] : []),
        ],
        conflicts: noteConflicts(conflicts) ?? [],
        audit_doc_ids: [doc.meta.id],
      };
    },
  },
  {
    name: 'who_owns',
    description: 'Look up the owning team, on-call alias, channel and tier for a service from the ownership table. If the service overview document names a different owner, the disagreement is returned in `conflicts`.',
    readOnly: true,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['service'],
      properties: { service: { type: 'string', minLength: 2, maxLength: 80, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' }, role: roleProp },
    },
    handler(ctx, a, role) {
      const name = String(a.service).toLowerCase();
      const rows = ctx.index.ownershipRows();
      const row = rows.find(r => r.service === name);
      if (!row) {
        const suggestions = rows.map(r => r.service).filter(s => s.includes(name) || name.includes(s) || s.split('-').some(p => name.includes(p) && p.length > 3)).slice(0, 5);
        throw new ToolError('NOT_FOUND', `No service "${a.service}" in the ownership table.`, { suggestions });
      }
      const lead = ctx.index.teamDirectory().find(t => t.team === row.owning_team);
      const conflicts: Array<{ doc_id: string; claimed_owner: string; updated: string; note: string }> = [];
      for (const d of ctx.index.docs.values()) {
        if (d.meta.service !== name || d.meta.type !== 'service' || !canRead(d.meta, role)) continue;
        if (d.meta.owner && d.meta.owner !== row.owning_team) {
          conflicts.push({
            doc_id: d.meta.id, claimed_owner: d.meta.owner, updated: d.meta.updated,
            note: `${d.meta.id} says ${d.meta.owner}; the ownership table says ${row.owning_team}. The table is the system of record, but confirm with ${lead?.channel ?? 'the team'}.`,
          });
        }
      }
      const ownershipDoc = ctx.index.docs.get('ownership-services')!;
      return {
        service: row.service, owning_team: row.owning_team, team_lead: lead?.lead ?? null, oncall_alias: row.oncall_alias,
        channel: row.channel, tier: Number(row.tier),
        source: { doc_id: 'ownership-services', section: row.service, last_updated: row.updated, freshness: freshness(row.updated, ctx.now()), table_last_updated: ownershipDoc.meta.updated },
        confidence: conflicts.length ? 'medium' : freshness(row.updated, ctx.now()) === 'stale' ? 'medium' : 'high',
        conflicts, audit_doc_ids: ['ownership-services', ...conflicts.map(c => c.doc_id)],
      };
    },
  },
  {
    name: 'answer_with_sources',
    description: 'Answer a question using only retrieved documents. Extractive (no generation): returns the most relevant snippets with doc id, section, last-updated date, freshness and confidence, a status of answered / answered_with_conflict / insufficient_evidence, and any conflicts or superseded-document warnings.',
    readOnly: true,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['question'],
      properties: {
        question: { type: 'string', minLength: 3, maxLength: 500 },
        max_sources: { type: 'integer', minimum: 1, maximum: 8, default: 3 },
        role: roleProp,
      },
    },
    handler(ctx, a, role) {
      const all = searchChunks(ctx.index, a.question, { role, now: ctx.now() });
      const hits = topDocs(all.filter(h => h.relevance >= MIN_SOURCE || h === all[0]), a.max_sources ?? 3);
      if (hits.length === 0 || hits[0].relevance < MIN_RELEVANCE) {
        return { question: a.question, role, status: 'insufficient_evidence', answer: null, sources: [], conflicts: [], warnings: ['No document the caller can read matches this question well enough to answer it. Do not guess; ask the owning team.'], audit_doc_ids: [] };
      }
      const conflicts = findConflicts(ctx.index, role, hits.map(h => h.meta.id));
      const active = conflicts.filter(c => c.kind === 'active_disagreement');
      const topics = new Set(active.map(c => c.topic));
      const sources = hits.map((h, i) => ({ ref: i + 1, ...resultDoc(h, a.question, topics, ctx) }));
      const warnings: string[] = [];
      for (const s of sources) {
        if (s.status === 'superseded') warnings.push(`[${s.ref}] ${s.doc_id} is superseded${s.superseded_by ? ` by ${s.superseded_by}` : ''}; do not rely on it.`);
        if (s.freshness === 'stale') warnings.push(`[${s.ref}] ${s.doc_id} was last updated ${s.last_updated} (${s.age_days} days ago).`);
      }
      // For a conflicted topic, show each disagreeing document's best-matching section so the caller sees both claims.
      const conflictDetail = active.map(c => ({
        ...c,
        claims: c.documents.map(d => {
          const best = all.find(h => h.meta.id === d.doc_id);
          return { doc_id: d.doc_id, last_updated: d.updated, section: best?.chunk.section ?? null, snippet: best ? snippet(best.chunk.text, a.question) : null };
        }),
      }));
      const lead = sources.find(s => s.status === 'active') ?? sources[0];
      const status = active.length ? 'answered_with_conflict' : 'answered';
      return {
        question: a.question, role, status,
        answer: active.length ? null : `${lead.snippet} [${lead.ref}]`,
        ...(active.length ? { answer_note: 'Sources disagree; no single answer is asserted. See conflicts and sources.' } : {}),
        sources, conflicts: [...conflictDetail, ...conflicts.filter(c => c.kind === 'superseded')], warnings,
        audit_doc_ids: sources.map(s => s.doc_id),
      };
    },
  },
  {
    name: 'reindex',
    description: 'Re-scan the knowledge base and re-index only added, changed or removed files. Admin only. Retries with the same request_id and arguments return the original result instead of re-running.',
    readOnly: false,
    inputSchema: {
      type: 'object', additionalProperties: false, required: [],
      properties: { request_id: { type: 'string', minLength: 4, maxLength: 80, pattern: '^[A-Za-z0-9._-]+$' }, role: roleProp },
    },
    handler(ctx, a, role): ReindexReport & { deduplicated?: boolean } {
      if (role !== 'admin') throw new ToolError('PERMISSION_DENIED', 'reindex requires the admin role.');
      const fingerprint = createHash('sha256').update(JSON.stringify({ role })).digest('hex');
      if (a.request_id) {
        const prior = ctx.dedupe.get(a.request_id);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new ToolError('INVALID_ARGUMENTS', `request_id "${a.request_id}" was already used with different arguments.`);
          return { ...(prior.result as ReindexReport), deduplicated: true };
        }
      }
      const report = ctx.index.reindex();
      ctx.lastScan = Date.now();
      if (a.request_id) {
        if (ctx.dedupe.size >= 200) ctx.dedupe.delete(ctx.dedupe.keys().next().value as string);
        ctx.dedupe.set(a.request_id, { fingerprint, result: report });
      }
      return report;
    },
  },
];

export function listTools() {
  return tools.map(t => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false },
  }));
}

/** Validate, authorise, run, audit. Throws ToolError for anything a caller can fix or should be told. */
export function callTool(ctx: Context, name: string, rawArgs: unknown): unknown {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new ToolError('UNKNOWN_TOOL', `Unknown tool "${name}". Available: ${tools.map(t => t.name).join(', ')}`);
  const args = rawArgs ?? {};
  const errors = validate(args, tool.inputSchema);
  if (errors.length) throw new ToolError('INVALID_ARGUMENTS', `Invalid arguments for ${name}:\n- ${errors.join('\n- ')}`, { errors });
  const requested = (args as { role?: Role }).role;
  if (ctx.lockedRole && requested && requested !== ctx.lockedRole) {
    audit(ctx, name, requested, 'denied', []);
    throw new ToolError('PERMISSION_DENIED', `This server is bound to role "${ctx.lockedRole}"; the role argument cannot be overridden.`);
  }
  const role = ctx.lockedRole ?? requested ?? ctx.defaultRole;
  if (name !== 'reindex' && Date.now() - ctx.lastScan >= ctx.refreshMs) {
    ctx.index.reindex();
    ctx.lastScan = Date.now();
  }
  try {
    const result = tool.handler(ctx, args, role) as { audit_doc_ids?: string[] };
    const ids = result.audit_doc_ids ?? [];
    audit(ctx, name, role, 'ok', ids);
    // audit ids are for the audit log; callers do not need them
    const { audit_doc_ids: _drop, ...rest } = result as Record<string, unknown>;
    return rest;
  } catch (e) {
    audit(ctx, name, role, e instanceof ToolError ? e.code : 'error', []);
    throw e;
  }
}

function audit(ctx: Context, tool: string, role: string, outcome: string, docIds: string[]) {
  if (!ctx.auditLog) return;
  // Queries are deliberately not logged (they can contain sensitive text); only who/what/outcome and which docs were served.
  appendFileSync(ctx.auditLog, JSON.stringify({ ts: new Date().toISOString(), tool, role, outcome, doc_ids: docIds }) + '\n');
}
