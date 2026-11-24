---
id: adr-0003-api-versioning
title: ADR-0003: Header-based API versioning
type: adr
updated: 2025-01-15
status: active
topic: adr-0003-api-versioning
owner: platform
---
# ADR-0003: Header-based API versioning

## Decision
Public APIs are versioned with a request header, not URL paths. Breaking changes require a new version and a 6-month deprecation window.
