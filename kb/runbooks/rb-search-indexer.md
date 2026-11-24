---
id: rb-search-indexer
title: Runbook: search-indexer
type: runbook
updated: 2026-05-11
status: active
service: search-indexer
owner: data
topic: runbook-search-indexer
---
# Runbook: search-indexer

## Symptoms
An alert on `index_lag_minutes`, or user reports that index lag grows when a malformed document blocks the batch.

## Diagnose
1. Open the search-indexer dashboard and check `index_lag_minutes` over the last 6 hours.
2. Check the last deploy time; roll back first if the symptom started within 30 minutes of a deploy.
3. Inspect dependencies: object storage, message queue.

## Mitigate
Restart the workers one at a time (never all at once). If search-indexer is tier 1, announce in the incident channel before restarting.

## Escalate
Page the data-oncall alias. Follow the escalation timing in the incident response runbook.
