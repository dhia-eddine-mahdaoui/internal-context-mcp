---
id: svc-payments-ledger
title: payments-ledger service overview
type: service
updated: 2026-09-02
status: active
service: payments-ledger
owner: payments
topic: service-payments-ledger
---
# payments-ledger

## Purpose
payments-ledger is a tier-1 Northwind Labs service. It listens on port 8420 inside the cluster and depends on Postgres cluster "ledger-pg".

## Data
Primary store: Postgres cluster "ledger-pg". Backups run nightly and are retained for 35 days.

## Known failure mode
double-posting if a retried write loses its idempotency key. The leading indicator is the `ledger_write_p99_ms` metric; the dashboard alert fires when it exceeds its weekly baseline by 3x.

## Ownership
Owned by the payments team. Questions go to #payments-eng.
