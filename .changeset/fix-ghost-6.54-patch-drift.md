---
"ghost-ses-email-adapter": patch
---

Fix `patches/ghost-6.x-email-adapter-wiring.patch` no longer applying against Ghost 6.54.0 (the version now served by the floating `ghost:6-alpine` tag). Ghost's `adapter-manager` compiled output changed how base-class dependencies are imported and switched its module export from `module.exports = adapterManager` to `exports.default = adapterManager`, so the regenerated patch adjusts context lines accordingly and updates the email adapter's `require('../adapter-manager')` call to read `.default`. Wiring behavior is unchanged: the custom email adapter is still injected as the `email` base class in `adapter-manager`'s singleton and consumed by `email-service-wrapper.js` the same way. Verified runtime references updated from 6.53.0 to 6.54.0.
