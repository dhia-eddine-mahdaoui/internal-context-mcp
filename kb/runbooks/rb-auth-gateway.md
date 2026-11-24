---
id: rb-auth-gateway
title: Runbook: auth-gateway
type: runbook
updated: 2026-07-21
status: active
service: auth-gateway
owner: platform
topic: runbook-auth-gateway
---
# Runbook: auth-gateway

## Symptoms
An alert on `login_p95_ms`, or user reports that login latency spikes when the session store evicts keys under memory pressure.

## Diagnose
1. Open the auth-gateway dashboard and check `login_p95_ms` over the last 6 hours.
2. Check the last deploy time; roll back first if the symptom started within 30 minutes of a deploy.
3. Inspect dependencies: session store (Redis), identity provider adapter.

## Mitigate
Restart the workers one at a time (never all at once). If auth-gateway is tier 1, announce in the incident channel before restarting.

## Escalate
Page the platform-oncall alias. Follow the escalation timing in the incident response runbook.
