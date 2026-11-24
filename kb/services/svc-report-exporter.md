---
id: svc-report-exporter
title: report-exporter service overview
type: service
updated: 2025-02-17
status: active
service: report-exporter
owner: finance-systems
topic: service-report-exporter
---
# report-exporter

## Purpose
report-exporter is a tier-3 Northwind Labs service. It listens on port 8480 inside the cluster and depends on warehouse, billing-api.

## Data
Primary store: object storage bucket "reports-bucket". Backups run nightly and are retained for 35 days.

## Known failure mode
month-end exports time out when the warehouse is under load. The leading indicator is the `export_duration_s` metric; the dashboard alert fires when it exceeds its weekly baseline by 3x.

## Ownership
Owned by the finance-systems team. Questions go to #finsys.
