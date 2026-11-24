export const ROLES = ['employee', 'platform', 'payments', 'growth', 'data', 'finance-systems', 'security', 'hr', 'finance', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const DOC_TYPES = ['handbook', 'runbook', 'adr', 'service', 'restricted', 'ownership'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export type DocStatus = 'active' | 'superseded';

export interface DocMeta {
  id: string;
  title: string;
  type: DocType;
  updated: string; // ISO date
  status: DocStatus;
  superseded_by?: string;
  restricted_to?: string[];
  owner?: string;
  service?: string;
  topic?: string;
  path: string; // relative to the KB root, forward slashes
}

export interface Chunk {
  docId: string;
  section: string;
  text: string;
  terms: Record<string, number>; // analysed term frequencies (title + section + body)
  len: number;
  vec: Array<[number, number]>; // sparse hashed embedding, L2-normalised
}

export interface IndexedDoc {
  meta: DocMeta;
  body: string;
  chunks: Chunk[];
}

export type Freshness = 'fresh' | 'aging' | 'stale';
export type Confidence = 'high' | 'medium' | 'low';

export class ToolError extends Error {
  constructor(public code: 'INVALID_ARGUMENTS' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'UNKNOWN_TOOL', message: string, public details?: unknown) {
    super(message);
  }
}
