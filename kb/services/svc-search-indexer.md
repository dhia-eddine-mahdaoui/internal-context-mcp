---
id: svc-search-indexer
title: search-indexer service overview
type: service
updated: 2026-05-11
status: active
service: search-indexer
owner: data
topic: service-search-indexer
---
# search-indexer

## Purpose
search-indexer is a tier-2 Northwind Labs service. It listens on port 8450 inside the cluster and depends on object storage, message queue.

## Data
Primary store: object storage bucket "idx-bucket". Backups run nightly and are retained for 35 days.

## Known failure mode
index lag grows when a malformed document blocks the batch. The leading indicator is the `index_lag_minutes` metric; the dashboard alert fires when it exceeds its weekly baseline by 3x.

## Ownership
Owned by the data team. Questions go to #data-eng.
