---
id: rb-payments-ledger
title: Runbook: payments-ledger
type: runbook
updated: 2026-09-02
status: active
service: payments-ledger
owner: payments
topic: runbook-payments-ledger
---
# Runbook: payments-ledger

## Symptoms
An alert on `ledger_write_p99_ms`, or user reports that double-posting if a retried write loses its idempotency key.

## Diagnose
1. Open the payments-ledger dashboard and check `ledger_write_p99_ms` over the last 6 hours.
2. Check the last deploy time; roll back first if the symptom started within 30 minutes of a deploy.
3. Inspect dependencies: Postgres cluster "ledger-pg".

## Mitigate
Restart the workers one at a time (never all at once). If payments-ledger is tier 1, announce in the incident channel before restarting.

## Escalate
Page the payments-oncall alias. Follow the escalation timing in the incident response runbook.
