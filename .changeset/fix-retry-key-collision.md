---
"ghost-ses-email-adapter": patch
---

Fix a critical bug where two concurrent batches of the same newsletter (Ghost sends each newsletter as multiple concurrent batches sharing one emailId) could collide on the retry/in-flight-send key, silently dropping one batch's recipients entirely while Ghost reported the send as successful.
