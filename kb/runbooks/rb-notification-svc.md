---
id: rb-notification-svc
title: Runbook: notification-svc
type: runbook
updated: 2026-06-30
status: active
service: notification-svc
owner: growth
topic: runbook-notification-svc
---
# Runbook: notification-svc

## Symptoms
An alert on `notif_send_lag_s`, or user reports that duplicate emails when workers restart mid-batch without a dedupe key.

## Diagnose
1. Open the notification-svc dashboard and check `notif_send_lag_s` over the last 6 hours.
2. Check the last deploy time; roll back first if the symptom started within 30 minutes of a deploy.
3. Inspect dependencies: message queue, email relay.

## Mitigate
Restart the workers one at a time (never all at once). If notification-svc is tier 1, announce in the incident channel before restarting.

## Escalate
Page the growth-oncall alias. Follow the escalation timing in the incident response runbook.
