---
id: rb-web-frontend
title: Runbook: web-frontend
type: runbook
updated: 2026-08-29
status: active
service: web-frontend
owner: growth
topic: runbook-web-frontend
---
# Runbook: web-frontend

## Symptoms
An alert on `js_error_rate`, or user reports that stale bundles served after a deploy when cache purge fails.

## Diagnose
1. Open the web-frontend dashboard and check `js_error_rate` over the last 6 hours.
2. Check the last deploy time; roll back first if the symptom started within 30 minutes of a deploy.
3. Inspect dependencies: auth-gateway, billing-api.

## Mitigate
Restart the workers one at a time (never all at once). If web-frontend is tier 1, announce in the incident channel before restarting.

## Escalate
Page the growth-oncall alias. Follow the escalation timing in the incident response runbook.
