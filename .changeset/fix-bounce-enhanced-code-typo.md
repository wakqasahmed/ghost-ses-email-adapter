---
"ghost-ses-email-adapter": patch
---

Fix a typo (`enhandedCode`) in the bounce error field emitted by `SESAnalyticsProvider`, which prevented Ghost core from ever reading the diagnostic `enhancedCode` and storing `enhanced_code: null` for every permanent/temporary bounce event.
