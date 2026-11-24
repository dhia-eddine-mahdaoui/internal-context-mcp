---
id: svc-web-frontend
title: web-frontend service overview
type: service
updated: 2026-08-29
status: active
service: web-frontend
owner: growth
topic: service-web-frontend
---
# web-frontend

## Purpose
web-frontend is a tier-2 Northwind Labs service. It listens on port 8470 inside the cluster and depends on auth-gateway, billing-api.

## Data
Primary store: CDN cache. Backups run nightly and are retained for 35 days.

## Known failure mode
stale bundles served after a deploy when cache purge fails. The leading indicator is the `js_error_rate` metric; the dashboard alert fires when it exceeds its weekly baseline by 3x.

## Ownership
Owned by the growth team. Questions go to #growth-eng.
