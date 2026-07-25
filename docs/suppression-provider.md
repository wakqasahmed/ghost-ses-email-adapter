# Suppression provider

Issue [#8](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues/8) added a standalone `SESSuppressionProvider`. It uses SESv2's account-level suppression list and follows Ghost's proposed suppression-adapter contract:

```js
const {SESSuppressionProvider} = require('ghost-ses-email-adapter');

const suppressionProvider = new SESSuppressionProvider({
    region: 'us-east-1'
});
```

It supports `getSuppressionData(email)`, `getBulkSuppressionData(emails)`, and `removeEmail(email)`. A `BOUNCE` maps to Ghost's `fail` reason and a `COMPLAINT` to `spam`. SES must have account-level suppression enabled and the runtime IAM identity needs `ses:GetSuppressedDestination` and `ses:DeleteSuppressedDestination`. Ghost still needs its separate suppression-adapter wiring before it can instantiate this provider automatically.

**Error handling is deliberately fail-closed, not fail-open.** A lookup failure other than "not found" (throttling, network error, permission issue) is rethrown rather than reported as `{suppressed: false}` — treating an unknown suppression status as "clear" risks re-sending to an address SES has already suppressed. `getBulkSuppressionData` bounds concurrent lookups to 10 in flight at a time specifically to reduce the chance of hitting SES's per-account TPS quota on large members-list pages; a genuine throttle or outage still propagates as an error rather than being silently swallowed, since self-hosters need to know their suppression checks are degraded, not have that hidden from them.
