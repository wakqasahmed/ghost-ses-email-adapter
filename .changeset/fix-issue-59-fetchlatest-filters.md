---
"ghost-ses-email-adapter": patch
---

Fix fetchLatest() ignoring the events/begin/end filters Ghost passes on each of its two analytics polling passes. Previously any SQS message was deleted (and its events dispatched) regardless of which pass received it first, routing opened events into the delivered/failed pass and vice versa. Now a message is only deleted once every event it contains has actually been consumed by this call's requested types and time window; otherwise it's left for the matching pass to pick up after its visibility timeout.
