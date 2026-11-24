---
id: rb-certificate-rotation
title: Runbook: TLS certificate rotation
type: runbook
updated: 2025-11-30
status: active
owner: platform
topic: runbook-cert-rotation
---
# Runbook: TLS certificate rotation

## Schedule
Public certificates rotate automatically 30 days before expiry. A calendar reminder fires at 45 days as a safety net.

## Manual rotation
If automation fails, issue a new certificate, upload it to the edge proxy, and reload one node at a time.

## Verify
Check the expiry date from outside the network and confirm the chain is complete.
