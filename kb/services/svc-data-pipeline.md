---
id: svc-data-pipeline
title: data-pipeline service overview
type: service
updated: 2026-04-03
status: active
service: data-pipeline
owner: data
topic: service-data-pipeline
---
# data-pipeline

## Purpose
data-pipeline is a tier-2 Northwind Labs service. It listens on port 8460 inside the cluster and depends on warehouse, message queue.

## Data
Primary store: warehouse schema "analytics". Backups run nightly and are retained for 35 days.

## Known failure mode
nightly load misses its window when upstream exports arrive late. The leading indicator is the `pipeline_freshness_h` metric; the dashboard alert fires when it exceeds its weekly baseline by 3x.

## Ownership
Owned by the data team. Questions go to #data-eng.
