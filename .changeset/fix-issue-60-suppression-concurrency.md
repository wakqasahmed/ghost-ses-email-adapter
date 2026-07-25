---
"ghost-ses-email-adapter": patch
---

Bound getBulkSuppressionData()'s concurrent SES lookups to 10 in flight at a time, instead of an unbounded Promise.all over the whole page. Reduces the chance that a large members-list page triggers the SES throttling that a single request would then propagate as an error. Fail-closed error handling (a lookup failure is not silently reported as "not suppressed") is intentionally preserved, not changed - see docs/suppression-provider.md for the tradeoff.
