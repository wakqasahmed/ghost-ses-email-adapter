---
"ghost-ses-email-adapter": patch
---

Document Ghost's actual newsletter sender_email verification mechanism (not Mailgun-specific) and add a safe, dry-run-by-default script for setting it directly, replacing ad hoc SQL.
