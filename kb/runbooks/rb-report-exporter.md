---
id: rb-report-exporter
title: Runbook: report-exporter
type: runbook
updated: 2024-01-09
status: active
service: report-exporter
owner: finance-systems
topic: runbook-report-exporter
---
# Runbook: report-exporter

## Symptoms
An alert on `export_duration_s`, or user reports that month-end exports time out when the warehouse is under load.

## Diagnose
1. Open the report-exporter dashboard and check `export_duration_s` over the last 6 hours.
2. Check the last deploy time; roll back first if the symptom started within 30 minutes of a deploy.
3. Inspect dependencies: warehouse, billing-api.

## Mitigate
Restart the workers one at a time (never all at once). If report-exporter is tier 1, announce in the incident channel before restarting.

## Escalate
Page the finsys-oncall alias. Follow the escalation timing in the incident response runbook.
