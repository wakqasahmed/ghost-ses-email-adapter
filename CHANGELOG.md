# ghost-ses-email-adapter

## 0.2.1

### Patch Changes

- 95cc2ed: Link the changelog from the README, note that the upstream wiring PR (TryGhost/Ghost#29553) eliminates patching entirely once merged, invite readers to support it, and sharpen the README's pitch for direct and Lambda-mediated SES sending.
- 0db95d4: Document Ghost's actual newsletter sender_email verification mechanism (not Mailgun-specific) and add a safe, dry-run-by-default script for setting it directly, replacing ad hoc SQL.
- ee646e9: Split the README into focused topic docs (installation, local development, suppression provider, sender-email verification); README now covers only what/why/how/supported versions plus a documentation index.

## 0.2.0

### Minor Changes

- 209606a: Add an SESv2 account-level suppression-list provider.
- 0adb1a6: Add a Lambda send transport for IAM-restricted and cross-account SES setups.

### Patch Changes

- 72958c9: Updated the recommended npm installation guidance, documented Docker-compatible
  local development, and required the complete email provider contract used by
  Ghost newsletter sending.

## 0.1.0

### Minor Changes

- abc13c8: Initial release.

### Patch Changes

- 8d5e8b4: Fix personalized unsubscribe delivery, tracking preferences, SES tag safety, RFC 2047 sender encoding, direct-send retry safety, concurrent duplicate-send coalescing, bounded retry-state retention, safe bulk Bcc headers, provider credential serialization, concurrency limits, and send error redaction.
