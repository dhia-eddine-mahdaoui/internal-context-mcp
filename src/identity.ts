// Caller identity comes from the transport, never from the request body.
//   HTTP : "Authorization: Bearer <caller key>" -> looked up by SHA-256 in the identity config -> { id, role }
//   stdio: the launcher names the identity (--as <id>); the process is trusted the way the user who started it is.
// The config stores only hashes of caller keys. Keys are generated at runtime by `identity init` and shown once.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { ROLES, Role } from './types.js';

export interface Caller { id: string; role: Role }

export interface IdentityConfig {
  callers: Array<{ id: string; role: Role; key_sha256: string; note?: string }>;
}

const sha = (s: string) => createHash('sha256').update(s).digest();

export class IdentityStore {
  constructor(private cfg: IdentityConfig) {
    for (const c of cfg.callers) if (!ROLES.includes(c.role)) throw new Error(`Identity "${c.id}" has unknown role "${c.role}".`);
    for (const c of cfg.callers) if (!/^[0-9a-f]{64}$/.test(c.key_sha256)) throw new Error(`Identity "${c.id}" has a malformed key hash.`);
    if (new Set(cfg.callers.map(c => c.id)).size !== cfg.callers.length) throw new Error('Duplicate caller ids in identity config.');
  }

  static load(path: string): IdentityStore {
    return new IdentityStore(JSON.parse(readFileSync(path, 'utf8')) as IdentityConfig);
  }

  /** Map a bearer credential to a caller. Compares hashes in constant time and checks every entry. */
  authenticate(authorization: string | undefined): Caller | null {
    const m = /^Bearer\s+(\S+)$/.exec(authorization ?? '');
    if (!m) return null;
    const presented = sha(m[1]);
    let found: Caller | null = null;
    for (const c of this.cfg.callers) {
      if (timingSafeEqual(presented, Buffer.from(c.key_sha256, 'hex')) && !found) found = { id: c.id, role: c.role };
    }
    return found;
  }

  byId(id: string): Caller | null {
    const c = this.cfg.callers.find(x => x.id === id);
    return c ? { id: c.id, role: c.role } : null;
  }

  ids(): string[] { return this.cfg.callers.map(c => c.id); }
}

/** Create a config for the given callers and return the freshly generated keys (shown once, never stored). */
export function generateIdentities(callers: Array<{ id: string; role: Role; note?: string }>): { config: IdentityConfig; keys: Record<string, string> } {
  const keys: Record<string, string> = {};
  const config: IdentityConfig = { callers: [] };
  for (const c of callers) {
    const key = 'ctxk_' + randomBytes(24).toString('base64url');
    keys[c.id] = key;
    config.callers.push({ id: c.id, role: c.role, key_sha256: sha(key).toString('hex'), ...(c.note ? { note: c.note } : {}) });
  }
  return { config, keys };
}

export const DEFAULT_CALLERS: Array<{ id: string; role: Role; note: string }> = [
  { id: 'agent-support', role: 'employee', note: 'support agent with the default employee view' },
  { id: 'agent-payments', role: 'payments', note: 'workflow agent owned by the payments team' },
  { id: 'agent-hr', role: 'hr', note: 'people-ops assistant' },
  { id: 'ops-admin', role: 'admin', note: 'can trigger reindex and read the audit log' },
];

export function writeIdentityConfig(path: string, config: IdentityConfig): void {
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}
