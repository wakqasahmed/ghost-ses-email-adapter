# ghost-ses-email-adapter

## 0.2.2

### Patch Changes

- ce58250: Fix a typo (`enhandedCode`) in the bounce error field emitted by `SESAnalyticsProvider`, which prevented Ghost core from ever reading the diagnostic `enhancedCode` and storing `enhanced_code: null` for every permanent/temporary bounce event.
- cc89c9f: Fix a latent recipient-list disclosure in the bulk (non-personalized) send path: the raw MIME message built for `SendRawEmailCommand` no longer includes a literal `Bcc:` header listing up to 50 subscriber addresses. SES's `Destinations` field already routes delivery to every recipient in the batch, so the header was both unnecessary and, since SES does not document stripping arbitrary `Bcc:` headers from raw messages, a potential way for batch recipients to see each other's addresses if ever passed through unchanged.
- 2966636: Fix `patches/ghost-6.x-email-adapter-wiring.patch` no longer applying against Ghost 6.54.0 (the version now served by the floating `ghost:6-alpine` tag). Ghost's `adapter-manager` compiled output changed how base-class dependencies are imported and switched its module export from `module.exports = adapterManager` to `exports.default = adapterManager`, so the regenerated patch adjusts context lines accordingly and updates the email adapter's `require('../adapter-manager')` call to read `.default`. Wiring behavior is unchanged: the custom email adapter is still injected as the `email` base class in `adapter-manager`'s singleton and consumed by `email-service-wrapper.js` the same way. Verified runtime references updated from 6.53.0 to 6.54.0.
- 06d45bc: Fix fetchLatest() ignoring the events/begin/end filters Ghost passes on each of its two analytics polling passes. Previously any SQS message was deleted (and its events dispatched) regardless of which pass received it first, routing opened events into the delivered/failed pass and vice versa. Now a message is only deleted once every event it contains has actually been consumed by this call's requested types and time window; otherwise it's left for the matching pass to pick up after its visibility timeout.
- b848bc3: Bound getBulkSuppressionData()'s concurrent SES lookups to 10 in flight at a time, instead of an unbounded Promise.all over the whole page. Reduces the chance that a large members-list page triggers the SES throttling that a single request would then propagate as an error. Fail-closed error handling (a lookup failure is not silently reported as "not suppressed") is intentionally preserved, not changed - see docs/suppression-provider.md for the tradeoff.
- 5ab25b9: Correct stale AGENTS.md (issue #8 became the suppression provider, not 5.x compatibility; note the patch's looser embedded EmailProviderBase contract as a follow-up bundled with #55), document that errorHandler has no effect via the interim wiring patch's AdapterManager instantiation path, and add docs/examples/CHANGELOG.md to the npm files whitelist so README-referenced doc links resolve for content-adapter installs extracted from the tarball.
- 47cee1f: Bump @tryghost/errors from ^1.3.7 to ^3.3.6, which drops the vulnerable transitive uuid dependency (GHSA-w5hq-g745-h8pq) entirely. Verified no breaking changes to the IncorrectUsageError/EmailError API surface this package uses — full test suite passes unchanged.
- 1133d5a: Stop a generic 'SES Error' fallback string from leaking into error `code`/`name` fields (only applied where a message is actually expected), replace the literal 'unknown' provider_id fallback with a traceable retry-key-derived value, and fix getTargetDeliveryWindow() to return milliseconds (0, since deliveryTime isn't honored) instead of an off-by-1000x seconds value.
- c0e93fd: Fix a critical bug where two concurrent batches of the same newsletter (Ghost sends each newsletter as multiple concurrent batches sharing one emailId) could collide on the retry/in-flight-send key, silently dropping one batch's recipients entirely while Ghost reported the send as successful.

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
