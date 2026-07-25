---
"ghost-ses-email-adapter": patch
---

Remove the unnecessary Bcc header from bulk sends (recipients already route via the SES Destinations parameter; AWS documents no guarantee a Bcc header is stripped before delivery), fix a bounce-error field typo (enhandedCode → enhancedCode) that silently dropped diagnostic codes, stop a generic 'SES Error' string from leaking into error `code`/`name` fields, replace the literal 'unknown' provider_id fallback with a traceable retry-key-derived value, and fix getTargetDeliveryWindow() to return milliseconds (0, since deliveryTime isn't honored) instead of an off-by-1000x seconds value.
