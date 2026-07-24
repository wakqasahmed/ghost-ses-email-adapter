# Suppression provider

Issue [#8](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues/8) added a standalone `SESSuppressionProvider`. It uses SESv2's account-level suppression list and follows Ghost's proposed suppression-adapter contract:

```js
const {SESSuppressionProvider} = require('ghost-ses-email-adapter');

const suppressionProvider = new SESSuppressionProvider({
    region: 'us-east-1'
});
```

It supports `getSuppressionData(email)`, `getBulkSuppressionData(emails)`, and `removeEmail(email)`. A `BOUNCE` maps to Ghost's `fail` reason and a `COMPLAINT` to `spam`. SES must have account-level suppression enabled and the runtime IAM identity needs `ses:GetSuppressedDestination` and `ses:DeleteSuppressedDestination`. Ghost still needs its separate suppression-adapter wiring before it can instantiate this provider automatically.
