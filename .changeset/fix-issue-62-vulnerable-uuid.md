---
"ghost-ses-email-adapter": patch
---

Bump @tryghost/errors from ^1.3.7 to ^3.3.6, which drops the vulnerable transitive uuid dependency (GHSA-w5hq-g745-h8pq) entirely. Verified no breaking changes to the IncorrectUsageError/EmailError API surface this package uses — full test suite passes unchanged.
