---
id: sec-postmortem-leaked-credential
title: Postmortem: leaked credential in a build log
type: restricted
updated: 2025-09-16
status: active
restricted_to: [security, platform]
topic: sec-postmortem-leaked-credential
---
# Postmortem: leaked credential in a build log

## Timeline
A build log exposed a service credential for roughly two hours before rotation.

## Actions
Build logs are now scrubbed by a masking step, and credentials rotate automatically after any exposure alert.
