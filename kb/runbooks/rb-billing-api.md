---
id: rb-billing-api
title: Runbook: billing-api
type: runbook
updated: 2026-08-14
status: active
service: billing-api
owner: payments
topic: runbook-billing-api
---
# Runbook: billing-api

## Symptoms
An alert on `invoice_queue_depth`, or user reports that invoice generation stalls when the ledger client pool is exhausted.

## Diagnose
1. Open the billing-api dashboard and check `invoice_queue_depth` over the last 6 hours.
2. Check the last deploy time; roll back first if the symptom started within 30 minutes of a deploy.
3. Inspect dependencies: payments-ledger, auth-gateway.

## Mitigate
Restart the workers one at a time (never all at once). If billing-api is tier 1, announce in the incident channel before restarting.

## Escalate
Page the payments-oncall alias. Follow the escalation timing in the incident response runbook.
