// Source connectors. Each one turns a file in the knowledge-base directory into documents with
// its own ACL (restricted_to), timestamp and status, so the rest of the server never cares where a document came from.
import { extractClaims } from './claims.js';
import { parseFrontMatter, splitSections } from './frontmatter.js';
import { analyze, embed, termFreq } from './text.js';
import { Chunk, DOC_TYPES, DocMeta, DocType, IndexedDoc } from './types.js';

export interface Connector {
  name: string;
  /** True when this connector owns the file (path is relative to the KB root, forward slashes). */
  accepts(rel: string): boolean;
  parse(rel: string, raw: string): IndexedDoc[];
}

export function chunkDoc(meta: DocMeta, sections: Array<{ heading: string; text: string }>): Chunk[] {
  return sections.map(s => {
    const terms = analyze(`${meta.title} ${meta.title} ${s.heading} ${s.text}`);
    return { docId: meta.id, section: s.heading, text: s.text, terms: termFreq(terms), len: terms.length, vec: embed(terms), claims: extractClaims(s.text) };
  });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const day = (ts: string) => ts.slice(0, 10);

// ---------- Markdown pages (front matter carries status, updated, topic, restricted_to) ----------
export const markdownConnector: Connector = {
  name: 'markdown',
  accepts: rel => rel.endsWith('.md'),
  parse(rel, raw) {
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
      source: 'markdown', path: rel,
    };
    return [{ meta: m, body, chunks: chunkDoc(m, splitSections(body, m.title)) }];
  },
};

// ---------- Ownership table (CSV) and team directory (JSON) ----------
export function parseCsv(raw: string): Record<string, string>[] {
  const [head, ...rows] = raw.split(/\r?\n/).filter(l => l.trim());
  const cols = head.split(',').map(c => c.trim());
  return rows.map(r => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v.trim()])));
}

export const ownershipConnector: Connector = {
  name: 'ownership',
  accepts: rel => rel.startsWith('ownership/'),
  parse(rel, raw) {
    if (rel.endsWith('.csv')) {
      const rows = parseCsv(raw) as Array<Record<string, string>>;
      const updated = rows.map(r => r.updated).sort().pop() ?? '1970-01-01';
      const meta: DocMeta = { id: 'ownership-services', title: 'Service ownership table', type: 'ownership', updated, status: 'active', topic: 'ownership', source: 'ownership', path: rel };
      const sections = rows.map(r => ({ heading: r.service, text: `Service ${r.service} is owned by the ${r.owning_team} team. On-call alias ${r.oncall_alias}, channel ${r.channel}, tier ${r.tier}. Row updated ${r.updated}.` }));
      return [{ meta, body: raw, chunks: chunkDoc(meta, sections) }];
    }
    const data = JSON.parse(raw) as { updated: string; teams: Array<{ team: string; lead: string; channel: string }> };
    const meta: DocMeta = { id: 'ownership-teams', title: 'Team directory', type: 'ownership', updated: data.updated, status: 'active', topic: 'ownership-teams', source: 'ownership', path: rel };
    const sections = data.teams.map(t => ({ heading: t.team, text: `Team ${t.team} is led by ${t.lead}. Channel ${t.channel}.` }));
    return [{ meta, body: raw, chunks: chunkDoc(meta, sections) }];
  },
};

// ---------- Ticket export (JSON): tickets/<project>.json ----------
// { project, acl?: [team], tickets: [{ key, title, status, updated, description, comments: [{author, ts, text}], restricted_to?, duplicate_of? }] }
interface TicketExport {
  project: string;
  acl?: string[];
  tickets: Array<{
    key: string; title: string; status: string; updated: string; reporter?: string; assignee?: string;
    description: string; comments?: Array<{ author: string; ts: string; text: string }>;
    restricted_to?: string[]; duplicate_of?: string;
  }>;
}

export const ticketConnector: Connector = {
  name: 'tickets',
  accepts: rel => rel.startsWith('tickets/') && rel.endsWith('.json'),
  parse(rel, raw) {
    const exp = JSON.parse(raw) as TicketExport;
    return exp.tickets.map(t => {
      const acl = t.restricted_to ?? exp.acl;
      const latest = [t.updated, ...(t.comments ?? []).map(c => day(c.ts))].sort().pop()!;
      const meta: DocMeta = {
        id: `tkt-${slug(t.key)}`, title: `${t.key}: ${t.title}`, type: 'ticket', updated: latest,
        // A ticket closed as a duplicate is treated like a superseded page: kept, flagged, demoted.
        status: t.duplicate_of ? 'superseded' : 'active',
        superseded_by: t.duplicate_of ? `tkt-${slug(t.duplicate_of)}` : undefined,
        restricted_to: acl && acl.length ? acl : undefined,
        owner: t.assignee, source: 'ticket', path: rel,
      };
      const sections = [
        { heading: 'Description', text: `Status ${t.status}. Reported by ${t.reporter ?? 'unknown'}. ${t.description}` },
        ...(t.comments ?? []).map((c, i) => ({ heading: `Comment ${i + 1}`, text: `${c.author} on ${day(c.ts)}: ${c.text}` })),
      ];
      const body = sections.map(s => `## ${s.heading}\n${s.text}`).join('\n\n');
      return { meta, body, chunks: chunkDoc(meta, sections) };
    });
  },
};

// ---------- Chat export (JSONL): chat/<channel>.jsonl ----------
// line 1: { channel, restricted_to? }, then one message per line: { ts, user, thread, text }. One document per thread.
export const chatConnector: Connector = {
  name: 'chat',
  accepts: rel => rel.startsWith('chat/') && rel.endsWith('.jsonl'),
  parse(rel, raw) {
    const lines = raw.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l) as Record<string, unknown>);
    const head = lines[0] as { channel: string; restricted_to?: string[] };
    const threads = new Map<string, Array<{ ts: string; user: string; text: string }>>();
    for (const m of lines.slice(1) as Array<{ ts: string; user: string; thread: string; text: string }>) {
      const list = threads.get(m.thread) ?? [];
      list.push({ ts: m.ts, user: m.user, text: m.text });
      threads.set(m.thread, list);
    }
    return [...threads.entries()].map(([thread, msgs]) => {
      const last = msgs.map(m => day(m.ts)).sort().pop()!;
      const meta: DocMeta = {
        id: `chat-${slug(head.channel)}-${slug(thread)}`, title: `${head.channel} thread: ${msgs[0].text.slice(0, 60)}`,
        type: 'chat', updated: last, status: 'active',
        restricted_to: head.restricted_to && head.restricted_to.length ? head.restricted_to : undefined,
        source: 'chat', path: rel,
      };
      const text = msgs.map(m => `${m.user} (${day(m.ts)}): ${m.text}`).join('\n');
      return { meta, body: text, chunks: chunkDoc(meta, [{ heading: 'Thread', text }]) };
    });
  },
};

export const CONNECTORS: Connector[] = [ownershipConnector, ticketConnector, chatConnector, markdownConnector];
export const SOURCE_FILE = /\.(md|csv|json|jsonl)$/;
