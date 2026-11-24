---
id: rb-data-pipeline
title: Runbook: data-pipeline
type: runbook
updated: 2026-04-03
status: active
service: data-pipeline
owner: data
topic: runbook-data-pipeline
---
# Runbook: data-pipeline

## Symptoms
An alert on `pipeline_freshness_h`, or user reports that nightly load misses its window when upstream exports arrive late.

## Diagnose
1. Open the data-pipeline dashboard and check `pipeline_freshness_h` over the last 6 hours.
2. Check the last deploy time; roll back first if the symptom started within 30 minutes of a deploy.
3. Inspect dependencies: warehouse, message queue.

## Mitigate
Restart the workers one at a time (never all at once). If data-pipeline is tier 1, announce in the incident channel before restarting.

## Escalate
Page the data-oncall alias. Follow the escalation timing in the incident response runbook.
