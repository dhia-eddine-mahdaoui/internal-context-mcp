---
id: svc-notification-svc
title: notification-svc service overview
type: service
updated: 2026-06-30
status: active
service: notification-svc
owner: platform
topic: service-notification-svc
---
# notification-svc

## Purpose
notification-svc is a tier-2 Northwind Labs service. It listens on port 8440 inside the cluster and depends on message queue, email relay.

## Data
Primary store: Postgres "notif-pg". Backups run nightly and are retained for 35 days.

## Known failure mode
duplicate emails when workers restart mid-batch without a dedupe key. The leading indicator is the `notif_send_lag_s` metric; the dashboard alert fires when it exceeds its weekly baseline by 3x.

## Ownership
Owned by the platform team. Questions go to #growth-eng.
