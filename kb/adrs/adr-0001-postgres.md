---
id: adr-0001-postgres
title: ADR-0001: Postgres as the default datastore
type: adr
updated: 2024-02-20
status: active
topic: adr-0001-postgres
owner: platform
---
# ADR-0001: Postgres as the default datastore

## Context
Teams were choosing datastores ad hoc, which fragmented on-call knowledge.

## Decision
Postgres is the default datastore for transactional services. Exceptions need an ADR.

## Consequences
Shared backup tooling and a single failover runbook.
