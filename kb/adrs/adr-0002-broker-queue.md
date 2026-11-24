---
id: adr-0002-broker-queue
title: ADR-0002: Use a broker-based queue for async jobs
type: adr
updated: 2024-05-06
status: superseded
topic: async-jobs-platform
owner: platform
superseded_by: adr-0006-managed-streaming
---
# ADR-0002: Use a broker-based queue for async jobs

## Decision
Asynchronous jobs run on a self-managed message broker with durable queues and a dead-letter queue per service.

## Status
Superseded by ADR-0006 after the managed streaming migration.
