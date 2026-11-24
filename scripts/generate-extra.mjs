// Synthetic ticket export (JSON) and chat export (JSONL) for Northwind Labs. Called by generate-kb.mjs.
// Everything is fictional. Each export file has its own ACL and timestamps.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function generateExtra(root) {
  mkdirSync(join(root, 'tickets'), { recursive: true });
  mkdirSync(join(root, 'chat'), { recursive: true });
  let tickets = 0, threads = 0;

  const ticketFile = (project, acl, list) => {
    tickets += list.length;
    writeFileSync(join(root, 'tickets', `${project.toLowerCase()}.json`), JSON.stringify({ project, ...(acl ? { acl } : {}), tickets: list }, null, 2) + '\n');
  };

  ticketFile('PLAT', null, [
    { key: 'PLAT-176', title: 'Access proxy sessions drop after a workday', status: 'resolved', updated: '2026-06-12', reporter: 'dana', assignee: 'amira',
      description: 'Several people were signed out of the access proxy in the middle of the afternoon and had to repeat the device-posture check.',
      comments: [{ author: 'amira', ts: '2026-06-12T10:20:00Z', text: 'Working as designed: access proxy sessions expire after 8 hours and then require a fresh device-posture check. Added a note to the VPN replacement guide.' }] },
    { key: 'PLAT-198', title: 'Remote access sessions expire too early', status: 'closed', updated: '2026-06-20', reporter: 'ravi', assignee: 'amira', duplicate_of: 'PLAT-176',
      description: 'Remote access keeps asking me to sign in again during the afternoon.', comments: [{ author: 'amira', ts: '2026-06-20T08:05:00Z', text: 'Duplicate of PLAT-176.' }] },
    { key: 'PLAT-212', title: 'Session store evicts keys under memory pressure', status: 'resolved', updated: '2026-07-21', reporter: 'sofia', assignee: 'amira',
      description: 'Login latency spiked twice this week. The auth-gateway session store evicted live sessions when memory was tight, so users were asked to sign in again.',
      comments: [
        { author: 'amira', ts: '2026-07-19T14:00:00Z', text: 'Root cause: the eviction policy removed live sessions first. Switched to evicting only keys with an expiry and raised the memory limit.' },
        { author: 'amira', ts: '2026-07-21T09:30:00Z', text: 'Login p95 is back under 400 ms. Closing.' }] },
    { key: 'PLAT-230', title: 'Renew edge certificates earlier', status: 'open', updated: '2026-10-08', reporter: 'amira', assignee: 'amira',
      description: 'Two edge certificates were renewed late because the renewal job ran during a deploy freeze. We want more margin before expiry.',
      comments: [{ author: 'amira', ts: '2026-10-08T11:00:00Z', text: 'Proposal agreed in the platform sync: public certificates should rotate automatically 21 days before expiry instead of waiting for the old window. The runbook still needs updating.' }] },
    { key: 'PLAT-244', title: 'Staging environment reset keeps failing', status: 'open', updated: '2026-10-22', reporter: 'noor', assignee: 'ravi',
      description: 'The weekly staging reset fails when the data refresh job is still running. Developers lose their test data on the next deploy.',
      comments: [{ author: 'ravi', ts: '2026-10-22T16:45:00Z', text: 'Reproduced. The reset should wait for the refresh job; patch is in review.' }] },
  ]);

  ticketFile('PAY', ['payments'], [
    { key: 'PAY-77', title: 'Idempotency key lost on retried ledger write', status: 'resolved', updated: '2026-09-02', reporter: 'jonas', assignee: 'mei',
      description: 'A retried write to payments-ledger posted twice because the retry path dropped the idempotency key.',
      comments: [{ author: 'mei', ts: '2026-09-01T12:00:00Z', text: 'Fixed: the key is now part of the retry envelope. Added a reconciliation check that flags duplicates within 24 hours.' }] },
    { key: 'PAY-81', title: 'Chargeback evidence upload fails for large files', status: 'open', updated: '2026-10-14', reporter: 'ana', assignee: 'mei',
      description: 'Uploads over 20 MB time out in the chargeback evidence form. Support has to email documents instead.', comments: [] },
    { key: 'PAY-90', title: 'Review fraud hold threshold', status: 'open', updated: '2026-10-27', reporter: 'jonas', assignee: 'jonas', restricted_to: ['payments', 'security'],
      description: 'Proposal to lower the manual review score threshold after last quarter card-testing attempts. Details are restricted to payments and security.', comments: [] },
  ]);

  ticketFile('DATA', null, [
    { key: 'DATA-301', title: 'Search index lag after a malformed document', status: 'resolved', updated: '2026-08-05', reporter: 'tomas', assignee: 'ines',
      description: 'The search-indexer fell behind by several hours after one malformed document blocked a batch.',
      comments: [{ author: 'ines', ts: '2026-08-05T09:00:00Z', text: 'The indexer now quarantines a document that fails parsing twice and continues with the batch. Alert fires when index lag exceeds 20 minutes.' }] },
    { key: 'DATA-315', title: 'Warehouse load missed its window', status: 'resolved', updated: '2026-09-18', reporter: 'ines', assignee: 'tomas',
      description: 'The nightly load finished late because an upstream export arrived after midnight.',
      comments: [{ author: 'tomas', ts: '2026-09-18T07:30:00Z', text: 'Load now waits for the export manifest instead of a fixed start time.' }] },
  ]);

  ticketFile('HR', ['hr'], [
    { key: 'HR-9', title: 'Clarify parental leave accrual', status: 'resolved', updated: '2026-05-30', reporter: 'marta', assignee: 'marta',
      description: 'Employees asked whether paid time off keeps accruing during parental leave.', comments: [{ author: 'marta', ts: '2026-05-30T13:00:00Z', text: 'It does. Policy text updated; managers were told in the people-ops sync.' }] },
  ]);

  const chatFile = (channel, acl, threadList) => {
    const lines = [{ channel, ...(acl ? { restricted_to: acl } : {}) }];
    for (const [thread, msgs] of threadList) { threads++; for (const [ts, user, text] of msgs) lines.push({ ts, user, thread, text }); }
    writeFileSync(join(root, 'chat', `${channel.replace('#', '')}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  };

  chatFile('#platform-help', null, [
    ['t1', [
      ['2026-10-28T09:12:00Z', 'dana', 'Quick one: how long do we wait before an unacknowledged page goes to the secondary?'],
      ['2026-10-28T09:15:00Z', 'amira', 'We agreed in the platform sync to tighten it. The primary now has 20 minutes to acknowledge, then the page goes to the secondary. The handbook has not caught up yet.'],
      ['2026-10-28T09:16:00Z', 'dana', 'Thanks, I will follow that until the policy page is updated.']]],
    ['t2', [
      ['2026-09-03T14:02:00Z', 'ravi', 'Is the old VPN really gone? My client still shows it.'],
      ['2026-09-03T14:05:00Z', 'amira', 'Yes. Use the access proxy with the device-posture check. The VPN profile is being removed from laptops this month.']]],
    ['t3', [
      ['2026-10-12T16:30:00Z', 'noor', 'Can I ship the config change on Friday afternoon? It is tiny.'],
      ['2026-10-12T16:34:00Z', 'ravi', 'Please do not. We avoid Friday deploys, and the on-call has to babysit anything that goes out. Ship Monday morning.']]],
    ['t4', [
      ['2026-10-09T10:00:00Z', 'sofia', 'Do certificate renewals really still happen 30 days out? PLAT-230 says 21.'],
      ['2026-10-09T10:07:00Z', 'amira', 'The automation is still on the old window until the change lands. Treat the ticket as the plan and the runbook as what runs today.']]],
    ['t5', [
      ['2025-02-11T11:00:00Z', 'dana', 'Staging reset happens every Sunday night, so push your test data before then.'],
      ['2025-02-11T11:20:00Z', 'ravi', 'Confirmed.']]],
  ]);

  chatFile('#growth-eng', null, [
    ['t1', [
      ['2026-10-02T13:10:00Z', 'priya', 'Customers got double emails again after the worker restart.'],
      ['2026-10-02T13:25:00Z', 'leo', 'Known issue with notification-svc: restarts mid-batch resend unless a dedupe key is set. Workaround for now is to drain the queue before restarting.']]],
    ['t2', [
      ['2026-09-10T09:00:00Z', 'priya', 'Reminder that notification-svc is owned by growth since the Q3 handoff, so page growth-oncall, not platform.']]],
  ]);

  chatFile('#random', null, [
    ['t1', [
      ['2026-10-21T12:40:00Z', 'kim', 'Finance said at the all-hands that expense receipts now need to be submitted within 14 days, not a month.'],
      ['2026-10-21T12:44:00Z', 'dana', 'Good to know, I had 30 in my head.']]],
    ['t2', [
      ['2026-10-05T08:15:00Z', 'noor', 'Where do I order a second monitor?'],
      ['2026-10-05T08:30:00Z', 'kim', 'Equipment stipend request in the people portal, then it arrives in about a week.']]],
  ]);

  chatFile('#payments-eng', ['payments'], [
    ['t1', [
      ['2026-10-16T15:00:00Z', 'mei', 'Chargeback reconciliation has to finish within 10 days of the dispute notice or we lose the case automatically.'],
      ['2026-10-16T15:02:00Z', 'jonas', 'Right, and evidence upload is blocked by PAY-81, so do it by email for now.']]],
  ]);

  chatFile('#security-private', ['security'], [
    ['t1', [
      ['2026-10-19T10:00:00Z', 'kofi', 'The leaked credential from the postmortem was rotated again today. Keep the details inside this channel.'],
      ['2026-10-19T10:05:00Z', 'ayo', 'Understood. I will also rotate the staging variant within 24 hours.']]],
  ]);

  chatFile('#people-ops', ['hr'], [
    ['t1', [
      ['2026-10-23T09:30:00Z', 'marta', 'Reminder: an offer above the top of the band needs sign-off from both the hiring manager and the finance partner. Do not promise anything before that.']]],
  ]);

  return { tickets, threads };
}
