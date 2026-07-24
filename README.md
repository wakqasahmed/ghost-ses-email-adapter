# ghost-ses-email-adapter

Amazon SES bulk email provider adapter for [Ghost](https://ghost.org), packaged as a standalone npm module following Ghost's community adapter conventions (the same pattern as Ghost storage adapters).

> **Status: pre-alpha — under active development.** See the [issues](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues) for the roadmap.

## Why

Ghost's native newsletter bulk-sending only integrates with Mailgun. Amazon SES support was proposed and implemented in [TryGhost/Ghost#25367](https://github.com/TryGhost/Ghost/pull/25367) but closed unmerged — Ghost core prefers a pluggable adapter mechanism with providers maintained by the community:

> "I think having an adapter mechanism would be enough for Ghost core. And self-hosters can use a 3rd party adapter to add SES or other providers to their Ghost sites." — Ghost core team, on #25367

This package is that community-maintained SES provider. A companion minimal PR to Ghost core (tracked in this repo's issues) proposes the small wiring change needed for stock Ghost to load third-party email adapters; until it lands, an interim patch enables the adapter on self-hosted installs.

## Locked-down AWS? Send through a Lambda

Keep verified identities, DKIM, sending reputation, and `ses:SendRawEmail` in a shared platform account while Ghost keeps only `lambda:InvokeFunction` on one designated function. Set `ses.transport` to `lambda`; the adapter invokes the function synchronously and still receives the SES MessageId needed for Ghost retries and analytics.

```json
{
  "ses": {
    "region": "eu-west-1",
    "fromEmail": "news@example.com",
    "transport": "lambda",
    "lambda": {
      "functionName": "arn:aws:lambda:eu-west-1:123456789012:function:ghost-ses-sender"
    }
  }
}
```

See the [reference handler](examples/lambda-ses-sender/index.js), [two IAM policies, deployment, and verification walkthrough](docs/lambda-transport.md). Direct SES remains the default.

## Supported Ghost versions

| Ghost version | Status | Verified runtime | Interim wiring patch | Disposable check |
| --- | --- | --- | --- | --- |
| 6.x | Supported | `ghost:6-alpine` (v6.53.0) | [`ghost-6.x-email-adapter-wiring.patch`](patches/ghost-6.x-email-adapter-wiring.patch) | `test/integration/ghost-6.sh` |
| 5.130.6 | Supported | `ghost:5.130.6-alpine` | [`ghost-5.x-email-adapter-wiring.patch`](patches/ghost-5.x-email-adapter-wiring.patch) | `test/integration/ghost-5.sh` |

Both versions need their matching patch until Ghost core ships third-party email adapter wiring. Other Ghost 5.x releases have not been verified; re-run the Ghost 5 disposable check against the exact version before using the patch. Re-run the matching disposable check before every Ghost upgrade.

## Choose an installation method

**Recommended for deployments: install the npm package.** It gives Ghost a
versioned adapter dependency and does not require this repository to remain on
the host:

```bash
cd current
npm install --omit=dev --no-save ses@npm:ghost-ses-email-adapter
```

The `ses` alias must match `adapters.email.active`. See [Install on Ghost
6.x](#install-on-ghost-6x) for the matching configuration and production
setup.

**Use a source checkout only for local adapter development.** The Docker
development workflow below bind-mounts this repository into the Ghost
container, so code changes are available immediately. It is not the
recommended production installation method.

## Local development with the Ghost monorepo

For local development against the Ghost 6 adapter-wiring branch, use its
`compose.dev.ses.yaml` overlay. It bind-mounts this checkout directly into the
Ghost development container at
`/home/ghost/ghost/core/content/adapters/email/ses`, which is the path Ghost
searches for content adapters. Do not create a host-specific absolute symlink
inside the Ghost checkout: it cannot resolve inside the container.

The overlay is introduced by [TryGhost/Ghost#29553](https://github.com/TryGhost/Ghost/pull/29553).
Check out that branch before starting this workflow.

1. Install this checkout's dependencies so they are present in the bind mount:

   ```bash
   npm ci
   ```

2. From the Ghost checkout, start development with the adapter overlay. The
   `SES_ADAPTER_PATH` default is a sibling `../ghost-ses-email-adapter`
   checkout, and can be changed for another location:

   ```bash
   SES_ADAPTER_PATH=../ghost-ses-email-adapter \
   SES_FROM_EMAIL=news@example.com \
   DEV_COMPOSE_FILES='-f compose.dev.ses.yaml' \
   pnpm dev
   ```

   Set `SES_REGION` and `SES_FROM_EMAIL` for the sender under test. Provide
   AWS credentials through the AWS SDK default credential provider chain; do
   not commit credentials or local configuration.

3. In another terminal, verify Ghost is healthy and has not failed adapter
   resolution before using the browser:

   ```bash
   SES_ADAPTER_PATH=../ghost-ses-email-adapter \
   docker compose -f compose.dev.yaml -f compose.dev.ses.yaml up -d --wait
   docker logs ghost-dev
   ```

   Ghost must remain running and healthy, and the logs must not contain
   `Unable to find email adapter ses`. Then open
   `http://localhost:2368/ghost`, create a test newsletter, and send a test
   email.

## Install on Ghost 6.x

This interim setup uses the bundled wiring patch because stock Ghost does not yet resolve email adapters. The patch was last verified against the **v6.53.0** runtime embedded in `ghost:6-alpine`; re-run the disposable integration check before applying it to an updated Ghost runtime.

1. Apply [`patches/ghost-6.x-email-adapter-wiring.patch`](patches/ghost-6.x-email-adapter-wiring.patch) from the running Ghost runtime directory (`/var/lib/ghost/current` in the official image):

   ```bash
   cd /var/lib/ghost/current
   git apply /path/to/ghost-6.x-email-adapter-wiring.patch
   ```

2. Install the adapter using one discovery method. The npm package alias is
   recommended for deployments; use the content-adapter method only when you
   intentionally manage adapter files under `content/adapters/`.

   **Recommended: npm package alias** — run this from the Ghost installation root (the directory containing `current/`). The alias makes the package resolvable as the configured `ses` adapter:

   ```bash
   cd current
   npm install --omit=dev --no-save ses@npm:ghost-ses-email-adapter
   ```

   **Content adapter** — extract the package at exactly `content/adapters/email/ses/` under the Ghost installation root:

   ```bash
   mkdir -p content/adapters/email/ses
   npm pack ghost-ses-email-adapter
   tar -xzf ghost-ses-email-adapter-*.tgz --strip-components=1 -C content/adapters/email/ses
   npm install --omit=dev --prefix content/adapters/email/ses
   ```

3. Add this block to `config.production.json`, replacing the example values. `active` must be `ses`.

   ```json
   {
     "adapters": {
       "email": {
         "active": "ses",
         "ses": {
           "region": "eu-west-1",
           "fromEmail": "news@example.com",
           "transport": "direct",
           "configurationSets": {
             "openAndClick": "ghost-track-open-and-click",
             "openOnly": "ghost-track-open-only",
             "clickOnly": "ghost-track-click-only",
             "disabled": "ghost-track-disabled"
           },
           "accessKeyId": "AWS_ACCESS_KEY_ID",
           "secretAccessKey": "AWS_SECRET_ACCESS_KEY"
         }
       }
     }
   }
   ```

   `accessKeyId` and `secretAccessKey` are optional credentials. Prefer the AWS SDK default credential provider chain: omit both keys and supply an IAM role, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables, or another supported AWS credential source. Never commit real credentials to Ghost configuration.

   `transport` defaults to `direct`. For IAM-restricted or cross-account SES, set it to `lambda` and add `lambda.functionName`; `lambda.region` is optional and falls back to `ses.region`. See the [Lambda transport walkthrough](docs/lambda-transport.md).

   Create the four SES configuration sets shown above. Their event destinations must respectively publish open-and-click, open-only, click-only, and no open/click events. The adapter selects the matching set for Ghost's `openTrackingEnabled` and `clickTrackingEnabled` flags. A legacy `configurationSet` remains supported only when both flags are enabled; configure a `disabled` set to make opt-outs explicit.

   Ghost retries a failed provider `send()` call for the entire provider batch, so this adapter advertises one recipient per batch. The adapter coalesces concurrent identical sends and retains successful recipients and bulk batches during an in-process retry. It identifies retries by Ghost's `emailId`, a caller-provided `idempotencyKey`, or an identical send payload. Retry state is capped at 1,000 keys (oldest first) to bound memory and in-process recipient-data retention. This protection is not durable across process restarts; callers needing durable idempotency must provide it outside the adapter.

4. Restart Ghost after applying the patch, installing the adapter, and updating configuration.

### Docker

Build a derived image so the patch and adapter are present on every container start. The following Dockerfile assumes this repository is the build context:

```dockerfile
FROM ghost:6.53.0-alpine

USER root
RUN apk add --no-cache git
COPY patches/ghost-6.x-email-adapter-wiring.patch /tmp/ghost-email-adapter.patch
RUN cd /var/lib/ghost/current \
    && git apply /tmp/ghost-email-adapter.patch \
    && npm install --omit=dev --no-save ses@npm:ghost-ses-email-adapter
USER node
```

Pass AWS credentials to the container through its secret manager or environment, and mount/provide the same `adapters.email` configuration shown above. Do not bake credentials into the image or Dockerfile.

### Disposable integration check

Run the repository's disposable Ghost 6.x integration harness with Docker installed:

```bash
test/integration/ghost-6.sh
```

It builds a throwaway `ses-adapter-test-*` image using a local `npm pack` archive, starts Ghost with SQLite and obvious fake AWS credentials, waits for Ghost to boot, then prints:

```text
ADAPTER_CONSTRUCTOR=SESEmailProvider
```

The harness deliberately uses the floating `ghost:6-alpine` image, so each run tests the Ghost 6.x release Docker Hub serves at that time. It uses a tmpfs-backed Ghost content directory and its trap removes only the image, container, and temporary directory created by that run. Run it before applying the patch to a Ghost update (and twice to confirm repeatability); it never sends through SES.

### Non-Docker

For a normal Ghost installation, apply the patch from its active runtime directory (the directory equivalent to `/var/lib/ghost/current`), then install the npm alias there, update `config.production.json`, and restart through its normal service manager. Use the content-adapter path only when you intentionally manage adapters under `content/adapters/`.

## Install on Ghost 5.x

Ghost 5.130.6 uses the same adapter configuration and installation methods as Ghost 6, but its runtime files have different casing and adapter registration. Apply [`patches/ghost-5.x-email-adapter-wiring.patch`](patches/ghost-5.x-email-adapter-wiring.patch) from `/var/lib/ghost/current`, then complete steps 2–4 in the Ghost 6 instructions above. Re-validate the patch against the exact runtime before using it on another Ghost 5.x release.

Run the matching disposable check before using the patch:

```bash
test/integration/ghost-5.sh
```

It prints the following marker after Ghost starts and the patched email service wires the SES provider into `SendingService`:

```text
EMAIL_PROVIDER=SESEmailProvider
```

## Upstream status

This patch is temporary. It becomes unnecessary after the upstream Ghost adapter wiring work tracked by [issue #5](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues/5) is merged and released. It was last verified against the embedded Ghost v6.53.0 runtime; re-run the integration check before every Ghost upgrade.

## Current capabilities

The adapter sends Ghost newsletter bulk email through SES. Its interim Ghost patches wire only that sending provider.

Issue [#6](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues/6) added an SES analytics provider for opens, bounces, and complaints via SES → SNS → SQS. Ghost does not yet have the separate analytics-adapter wiring required to load it, so analytics is not currently a usable Ghost feature. The [analytics setup notes](https://github.com/wakqasahmed/ghost-ses-email-adapter/blob/main/docs/analytics-setup.md) describe the required infrastructure for when that wiring exists.

Issue [#8](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues/8) adds a standalone `SESSuppressionProvider`. It uses SESv2's account-level suppression list and follows Ghost's proposed suppression-adapter contract:

```js
const {SESSuppressionProvider} = require('ghost-ses-email-adapter');

const suppressionProvider = new SESSuppressionProvider({
    region: 'us-east-1'
});
```

It supports `getSuppressionData(email)`, `getBulkSuppressionData(emails)`, and `removeEmail(email)`. A `BOUNCE` maps to Ghost's `fail` reason and a `COMPLAINT` to `spam`. SES must have account-level suppression enabled and the runtime IAM identity needs `ses:GetSuppressedDestination` and `ses:DeleteSuppressedDestination`. Ghost still needs its separate suppression-adapter wiring before it can instantiate this provider automatically.

## Credits

The provider implementation is ported from the excellent work by [**@danielraffel**](https://github.com/danielraffel) in [TryGhost/Ghost#25367](https://github.com/TryGhost/Ghost/pull/25367) (MIT). This repo packages and maintains it as a standalone module.

## License

MIT
