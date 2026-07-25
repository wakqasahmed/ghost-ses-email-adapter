---
"ghost-ses-email-adapter": patch
---

Stop a generic 'SES Error' fallback string from leaking into error `code`/`name` fields (only applied where a message is actually expected), replace the literal 'unknown' provider_id fallback with a traceable retry-key-derived value, and fix getTargetDeliveryWindow() to return milliseconds (0, since deliveryTime isn't honored) instead of an off-by-1000x seconds value.
