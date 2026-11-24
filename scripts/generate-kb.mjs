// Generates the synthetic Northwind Labs knowledge base into ./kb.
// Everything here is fictional. Re-running overwrites kb/ deterministically.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'kb');
rmSync(root, { recursive: true, force: true });

let count = 0;
function doc(dir, id, meta, body) {
  const fm = ['---', `id: ${id}`];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined) continue;
    fm.push(`${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`);
  }
  fm.push('---', '');
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, `${id}.md`), fm.join('\n') + body.trim() + '\n');
  count++;
}

// ---------- Services (drive overview + runbook docs and the ownership CSV) ----------
const services = [
  { id: 'billing-api', team: 'payments', alias: 'payments-oncall', chan: '#payments-eng', tier: 1, port: 8410, deps: 'payments-ledger, auth-gateway', store: 'Postgres cluster "bill-pg"', fail: 'invoice generation stalls when the ledger client pool is exhausted', metric: 'invoice_queue_depth', updated: '2026-08-14' },
  { id: 'payments-ledger', team: 'payments', alias: 'payments-oncall', chan: '#payments-eng', tier: 1, port: 8420, deps: 'Postgres cluster "ledger-pg"', store: 'Postgres cluster "ledger-pg"', fail: 'double-posting if a retried write loses its idempotency key', metric: 'ledger_write_p99_ms', updated: '2026-09-02' },
  { id: 'auth-gateway', team: 'platform', alias: 'platform-oncall', chan: '#platform-help', tier: 1, port: 8430, deps: 'session store (Redis), identity provider adapter', store: 'Redis "sess-redis"', fail: 'login latency spikes when the session store evicts keys under memory pressure', metric: 'login_p95_ms', updated: '2026-07-21' },
  { id: 'notification-svc', team: 'growth', alias: 'growth-oncall', chan: '#growth-eng', tier: 2, port: 8440, deps: 'message queue, email relay', store: 'Postgres "notif-pg"', fail: 'duplicate emails when workers restart mid-batch without a dedupe key', metric: 'notif_send_lag_s', updated: '2026-06-30' },
  { id: 'search-indexer', team: 'data', alias: 'data-oncall', chan: '#data-eng', tier: 2, port: 8450, deps: 'object storage, message queue', store: 'object storage bucket "idx-bucket"', fail: 'index lag grows when a malformed document blocks the batch', metric: 'index_lag_minutes', updated: '2026-05-11' },
  { id: 'data-pipeline', team: 'data', alias: 'data-oncall', chan: '#data-eng', tier: 2, port: 8460, deps: 'warehouse, message queue', store: 'warehouse schema "analytics"', fail: 'nightly load misses its window when upstream exports arrive late', metric: 'pipeline_freshness_h', updated: '2026-04-03' },
  { id: 'web-frontend', team: 'growth', alias: 'growth-oncall', chan: '#growth-eng', tier: 2, port: 8470, deps: 'auth-gateway, billing-api', store: 'CDN cache', fail: 'stale bundles served after a deploy when cache purge fails', metric: 'js_error_rate', updated: '2026-08-29' },
  { id: 'report-exporter', team: 'finance-systems', alias: 'finsys-oncall', chan: '#finsys', tier: 3, port: 8480, deps: 'warehouse, billing-api', store: 'object storage bucket "reports-bucket"', fail: 'month-end exports time out when the warehouse is under load', metric: 'export_duration_s', updated: '2025-02-17' },
];

for (const s of services) {
  // Deliberate disagreement: the service overview for notification-svc names a different owner than the ownership CSV.
  const docOwner = s.id === 'notification-svc' ? 'platform' : s.team;
  doc('services', `svc-${s.id}`, {
    title: `${s.id} service overview`, type: 'service', updated: s.updated, status: 'active',
    service: s.id, owner: docOwner, topic: `service-${s.id}`,
  }, `
# ${s.id}

## Purpose
${s.id} is a tier-${s.tier} Northwind Labs service. It listens on port ${s.port} inside the cluster and depends on ${s.deps}.

## Data
Primary store: ${s.store}. Backups run nightly and are retained for 35 days.

## Known failure mode
${s.fail}. The leading indicator is the \`${s.metric}\` metric; the dashboard alert fires when it exceeds its weekly baseline by 3x.

## Ownership
Owned by the ${docOwner} team. Questions go to ${s.chan}.
`);
  doc('runbooks', `rb-${s.id}`, {
    title: `Runbook: ${s.id}`, type: 'runbook', updated: s.id === 'report-exporter' ? '2024-01-09' : s.updated, status: 'active',
    service: s.id, owner: s.team, topic: `runbook-${s.id}`,
  }, `
# Runbook: ${s.id}

## Symptoms
An alert on \`${s.metric}\`, or user reports that ${s.fail}.

## Diagnose
1. Open the ${s.id} dashboard and check \`${s.metric}\` over the last 6 hours.
2. Check the last deploy time; roll back first if the symptom started within 30 minutes of a deploy.
3. Inspect dependencies: ${s.deps}.

## Mitigate
Restart the workers one at a time (never all at once). If ${s.id} is tier 1, announce in the incident channel before restarting.

## Escalate
Page the ${s.alias} alias. Follow the escalation timing in the incident response runbook.
`);
}

// ---------- Handbook ----------
const hb = (id, title, updated, body, extra = {}) => doc('handbook', id, { title, type: 'handbook', updated, status: 'active', topic: id, ...extra }, body);

hb('hb-remote-work', 'Remote work policy', '2026-03-10', `
# Remote work policy

## Eligibility
All employees may work remotely up to four days a week. Core collaboration hours are 10:00 to 15:00 in your own time zone.

## Working abroad
You may work from another country for up to 30 days per calendar year with manager approval. Longer stays need a legal review from People Operations.

## Equipment
The company provides one laptop and a monitor stipend of 250 units of currency, claimable once every three years.
`);
hb('hb-expenses', 'Expense policy', '2026-01-22', `
# Expense policy

## What is reimbursable
Travel, accommodation for approved trips, client meals, and approved software. Submit receipts within 30 days.

## Limits
Meals while travelling are capped at 60 per day. Anything above 500 for a single item needs prior approval from your director.

## Travel booking
Book through the travel portal. Economy class for flights under six hours; premium economy is allowed beyond that.
`);
hb('hb-expenses-travel-2023', 'Travel booking rules (2023)', '2023-04-18', `
# Travel booking rules

## Limits
Hotel nights are capped at 140 per night in all cities. Book flights at least 14 days ahead.

## Notes
This page was replaced by the 2026 expense policy and the travel portal rules.
`, { status: 'superseded', superseded_by: 'hb-expenses', topic: 'hb-expenses' });
hb('hb-pto', 'Paid time off', '2026-02-05', `
# Paid time off

## Accrual
Full-time employees receive 25 days of paid time off per year, accrued monthly. Up to 5 unused days carry over into the next year.

## Requesting
Request time off in the people tool at least two weeks ahead for absences longer than three days.

## Public holidays
Public holidays are not deducted from your balance. See the holiday calendar page.
`);
hb('hb-holidays', 'Company holiday calendar 2026', '2025-12-12', `
# Company holiday calendar 2026

## Fixed closure days
The office closes between 24 December and 1 January. Emergency on-call coverage continues during closure.

## Floating days
Each employee has two floating holidays to use for local or personal observances.
`);
hb('hb-onboarding', 'Onboarding: your first week', '2026-05-19', `
# Onboarding: your first week

## Day one
Collect your laptop, set up multi-factor authentication, and join your team channel.

## Week one
Shadow an on-call shift, read the engineering handbook, and ship a small change to production with your buddy by Friday.

## Accounts
Your manager files the access request. Standard access is granted within one business day.
`);
hb('hb-oncall-policy', 'On-call policy', '2026-09-20', `
# On-call policy

## Rotation
Each team runs a weekly primary and secondary on-call rotation. Swaps are agreed in the team channel.

## Escalation timing
If the primary on-call has not acknowledged a page within 30 minutes, the page escalates to the secondary and then to the engineering manager.

## Compensation
On-call weeks earn one day of recovery time, taken within the following month.
`, { owner: 'platform', topic: 'oncall-escalation' });
hb('hb-security-awareness', 'Security awareness basics', '2026-04-27', `
# Security awareness basics

## Credentials and MFA
Use the company credential vault. Multi-factor authentication is mandatory for every internal system.

## Phishing
Report suspicious messages with the report button in the mail client. Security triages reports within four hours on business days.

## Devices
Lost or stolen devices must be reported to security immediately so they can be wiped remotely.
`);
hb('hb-vpn-2023', 'VPN access policy (2023)', '2023-09-01', `
# VPN access policy

## Requirement
All engineers must connect through the corporate VPN to reach internal dashboards. Sessions expire after 12 hours.
`, { status: 'superseded', superseded_by: 'hb-vpn-2025', topic: 'vpn-policy', owner: 'security' });
hb('hb-vpn-2025', 'Zero-trust access policy (replaces VPN)', '2025-10-03', `
# Zero-trust access policy

## Requirement
Internal dashboards are reached through the identity-aware access proxy. The corporate VPN was retired in October 2025; do not request VPN accounts.

## Sessions
Access proxy sessions expire after 8 hours and require a fresh device-posture check.
`, { topic: 'vpn-policy', owner: 'security' });
hb('hb-engineering-handbook', 'Engineering handbook', '2026-06-08', `
# Engineering handbook

## Code review
Every change needs one approving review from a code owner. Changes to tier-1 services need two.

## Deploys
Deploys are allowed on weekdays before 16:00 local time. Friday deploys to tier-1 services need director approval.

## Incident follow-up
Every severity 1 or 2 incident gets a written postmortem within five working days.
`);
hb('hb-staging-guide', 'Staging environment guide', '2022-03-14', `
# Staging environment guide

## Access
Staging is shared by all teams. Reserve the environment in the booking sheet before deploying a branch.

## Data
Staging holds a nightly anonymised copy of production data.
`);

// ---------- Cross-cutting runbooks ----------
doc('runbooks', 'rb-incident-response', {
  title: 'Runbook: incident response', type: 'runbook', updated: '2024-06-02', status: 'active', owner: 'platform', topic: 'oncall-escalation',
}, `
# Runbook: incident response

## Declare
Open an incident channel named inc-YYYYMMDD-short-title and page the incident commander alias.

## Roles
Incident commander coordinates, the scribe keeps a timeline, and the communications lead updates the status page.

## Escalation timing
If the primary on-call has not acknowledged within 15 minutes, page the secondary on-call, then the engineering manager.

## Closing
Resolve the status page entry and schedule the postmortem.
`);
doc('runbooks', 'rb-database-failover', {
  title: 'Runbook: Postgres failover', type: 'runbook', updated: '2026-02-11', status: 'active', owner: 'platform', topic: 'runbook-db-failover',
}, `
# Runbook: Postgres failover

## When to fail over
Fail over when the primary has been unreachable for more than five minutes or replication lag exceeds 10 minutes and is growing.

## Procedure
1. Freeze deploys for the affected service.
2. Promote the most caught-up replica using the failover command in the database tooling.
3. Repoint the connection alias and confirm writes succeed.
4. Rebuild the old primary as a replica after the incident.

## Verify
Run the smoke test suite for each service that uses the cluster.
`);
doc('runbooks', 'rb-certificate-rotation', {
  title: 'Runbook: TLS certificate rotation', type: 'runbook', updated: '2025-11-30', status: 'active', owner: 'platform', topic: 'runbook-cert-rotation',
}, `
# Runbook: TLS certificate rotation

## Schedule
Public certificates rotate automatically 30 days before expiry. A calendar reminder fires at 45 days as a safety net.

## Manual rotation
If automation fails, issue a new certificate, upload it to the edge proxy, and reload one node at a time.

## Verify
Check the expiry date from outside the network and confirm the chain is complete.
`);

// ---------- ADRs ----------
const adr = (id, title, updated, body, extra = {}) => doc('adrs', id, { title, type: 'adr', updated, status: 'active', topic: id, owner: 'platform', ...extra }, body);
adr('adr-0001-postgres', 'ADR-0001: Postgres as the default datastore', '2024-02-20', `
# ADR-0001: Postgres as the default datastore

## Context
Teams were choosing datastores ad hoc, which fragmented on-call knowledge.

## Decision
Postgres is the default datastore for transactional services. Exceptions need an ADR.

## Consequences
Shared backup tooling and a single failover runbook.
`);
adr('adr-0002-broker-queue', 'ADR-0002: Use a broker-based queue for async jobs', '2024-05-06', `
# ADR-0002: Use a broker-based queue for async jobs

## Decision
Asynchronous jobs run on a self-managed message broker with durable queues and a dead-letter queue per service.

## Status
Superseded by ADR-0006 after the managed streaming migration.
`, { status: 'superseded', superseded_by: 'adr-0006-managed-streaming', topic: 'async-jobs-platform' });
adr('adr-0003-api-versioning', 'ADR-0003: Header-based API versioning', '2025-01-15', `
# ADR-0003: Header-based API versioning

## Decision
Public APIs are versioned with a request header, not URL paths. Breaking changes require a new version and a 6-month deprecation window.
`);
adr('adr-0006-managed-streaming', 'ADR-0006: Move async jobs to managed streaming', '2026-03-28', `
# ADR-0006: Move async jobs to managed streaming

## Context
The self-managed broker needed constant patching and had no multi-region story.

## Decision
Async jobs move to a managed streaming service. Consumers use consumer groups and idempotent handlers. Migration finishes by Q4 2026.

## Consequences
The old broker runbooks are retired service by service.
`, { topic: 'async-jobs-platform' });

// ---------- Restricted docs ----------
const rs = (id, title, updated, teams, body) => doc('restricted', id, { title, type: 'restricted', updated, status: 'active', restricted_to: teams, topic: id }, body);
rs('hr-compensation-bands', 'Compensation bands 2026', '2026-01-31', ['hr', 'finance'], `
# Compensation bands 2026

## Bands
Engineer level 3 band: 70000 to 95000. Level 4 band: 90000 to 120000. Staff band: 115000 to 150000.

## Rules
Offers above the band midpoint need VP approval.
`);
rs('hr-performance-calibration', 'Performance calibration guide', '2026-05-12', ['hr'], `
# Performance calibration guide

## Process
Managers submit ratings by the second week of June. Calibration sessions are chaired by People Operations.
`);
rs('sec-pentest-findings', 'Penetration test findings 2026', '2026-07-08', ['security'], `
# Penetration test findings 2026

## Summary
Two high findings: an overly permissive internal admin endpoint and missing rate limits on account recovery. Fixes are tracked in the security backlog.
`);
rs('sec-postmortem-leaked-credential', 'Postmortem: leaked credential in a build log', '2025-09-16', ['security', 'platform'], `
# Postmortem: leaked credential in a build log

## Timeline
A build log exposed a service credential for roughly two hours before rotation.

## Actions
Build logs are now scrubbed by a masking step, and credentials rotate automatically after any exposure alert.
`);
rs('pay-fraud-rules', 'Payment fraud scoring rules', '2026-08-01', ['payments', 'security'], `
# Payment fraud scoring rules

## Thresholds
Transactions with a risk score above 80 are held for manual review. Three declined attempts in ten minutes lock the card for one hour.
`);
rs('fin-board-financials-q3', 'Board financial summary Q3', '2026-10-15', ['finance'], `
# Board financial summary Q3

## Highlights
Revenue grew modestly quarter over quarter; runway exceeds 30 months at the current burn rate.
`);

// ---------- Ownership data ----------
mkdirSync(join(root, 'ownership'), { recursive: true });
const csv = ['service,owning_team,oncall_alias,channel,tier,updated'];
for (const s of services) {
  csv.push(`${s.id},${s.team},${s.alias},${s.chan},${s.tier},${s.id === 'report-exporter' ? '2025-02-17' : '2026-09-30'}`);
}
writeFileSync(join(root, 'ownership', 'services.csv'), csv.join('\n') + '\n');
writeFileSync(join(root, 'ownership', 'teams.json'), JSON.stringify({
  updated: '2026-09-30',
  teams: [
    { team: 'platform', lead: 'Amira Okafor', channel: '#platform-help' },
    { team: 'payments', lead: 'Jonas Lindqvist', channel: '#payments-eng' },
    { team: 'growth', lead: 'Priya Raman', channel: '#growth-eng' },
    { team: 'data', lead: 'Tomas Herrera', channel: '#data-eng' },
    { team: 'finance-systems', lead: 'Lena Fischer', channel: '#finsys' },
    { team: 'security', lead: 'Kofi Mensah', channel: '#security' },
    { team: 'hr', lead: 'Marta Kowalska', channel: '#people-ops' },
    { team: 'finance', lead: 'Daniel Costa', channel: '#finance' },
  ],
}, null, 2) + '\n');
console.log(`generated ${count} markdown docs + 2 ownership files in kb/`);
