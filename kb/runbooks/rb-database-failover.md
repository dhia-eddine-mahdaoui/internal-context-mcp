---
id: rb-database-failover
title: Runbook: Postgres failover
type: runbook
updated: 2026-02-11
status: active
owner: platform
topic: runbook-db-failover
---
# Runbook: Postgres failover

## When to fail over
Fail over when the primary has been unreachable for more than five minutes or replication lag exceeds 10 minutes and is growing.

## Procedure
1. Freeze deploys for the affected service.
2. Promote the most caught-up replica using the failover command in the database tooling.
3. Repoint the connection alias and confirm writes succeed.
4. Rebuild the old primary as a replica after the incident.

## Verify
Run the smoke test suite for each service that uses the cluster.
