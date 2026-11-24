---
id: adr-0006-managed-streaming
title: ADR-0006: Move async jobs to managed streaming
type: adr
updated: 2026-03-28
status: active
topic: async-jobs-platform
owner: platform
---
# ADR-0006: Move async jobs to managed streaming

## Context
The self-managed broker needed constant patching and had no multi-region story.

## Decision
Async jobs move to a managed streaming service. Consumers use consumer groups and idempotent handlers. Migration finishes by Q4 2026.

## Consequences
The old broker runbooks are retired service by service.
