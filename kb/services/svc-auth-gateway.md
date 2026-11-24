---
id: svc-auth-gateway
title: auth-gateway service overview
type: service
updated: 2026-07-21
status: active
service: auth-gateway
owner: platform
topic: service-auth-gateway
---
# auth-gateway

## Purpose
auth-gateway is a tier-1 Northwind Labs service. It listens on port 8430 inside the cluster and depends on session store (Redis), identity provider adapter.

## Data
Primary store: Redis "sess-redis". Backups run nightly and are retained for 35 days.

## Known failure mode
login latency spikes when the session store evicts keys under memory pressure. The leading indicator is the `login_p95_ms` metric; the dashboard alert fires when it exceeds its weekly baseline by 3x.

## Ownership
Owned by the platform team. Questions go to #platform-help.
