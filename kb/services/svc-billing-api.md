---
id: svc-billing-api
title: billing-api service overview
type: service
updated: 2026-08-14
status: active
service: billing-api
owner: payments
topic: service-billing-api
---
# billing-api

## Purpose
billing-api is a tier-1 Northwind Labs service. It listens on port 8410 inside the cluster and depends on payments-ledger, auth-gateway.

## Data
Primary store: Postgres cluster "bill-pg". Backups run nightly and are retained for 35 days.

## Known failure mode
invoice generation stalls when the ledger client pool is exhausted. The leading indicator is the `invoice_queue_depth` metric; the dashboard alert fires when it exceeds its weekly baseline by 3x.

## Ownership
Owned by the payments team. Questions go to #payments-eng.
