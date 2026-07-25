---
"ghost-ses-email-adapter": patch
---

Fix a latent recipient-list disclosure in the bulk (non-personalized) send path: the raw MIME message built for `SendRawEmailCommand` no longer includes a literal `Bcc:` header listing up to 50 subscriber addresses. SES's `Destinations` field already routes delivery to every recipient in the batch, so the header was both unnecessary and, since SES does not document stripping arbitrary `Bcc:` headers from raw messages, a potential way for batch recipients to see each other's addresses if ever passed through unchanged.
