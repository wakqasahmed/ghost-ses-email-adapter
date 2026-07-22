# ghost-ses-email-adapter

Amazon SES bulk email provider adapter for [Ghost](https://ghost.org), packaged as a standalone npm module following Ghost's community adapter conventions (the same pattern as Ghost storage adapters).

> **Status: pre-alpha — under active development.** See the [issues](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues) for the roadmap.

## Why

Ghost's native newsletter bulk-sending only integrates with Mailgun. Amazon SES support was proposed and implemented in [TryGhost/Ghost#25367](https://github.com/TryGhost/Ghost/pull/25367) but closed unmerged — Ghost core prefers a pluggable adapter mechanism with providers maintained by the community:

> "I think having an adapter mechanism would be enough for Ghost core. And self-hosters can use a 3rd party adapter to add SES or other providers to their Ghost sites." — Ghost core team, on #25367

This package is that community-maintained SES provider. A companion minimal PR to Ghost core (tracked in this repo's issues) proposes the small wiring change needed for stock Ghost to load third-party email adapters; until it lands, an interim patch enables the adapter on self-hosted installs.

## Supported Ghost versions

| Ghost version | Status | Verified runtime | Interim wiring patch | Disposable check |
| --- | --- | --- | --- | --- |
| 6.x | Supported | `ghost:6-alpine` (v6.53.0) | [`ghost-6.x-email-adapter-wiring.patch`](patches/ghost-6.x-email-adapter-wiring.patch) | `test/integration/ghost-6.sh` |
| 5.130.6 | Supported | `ghost:5.130.6-alpine` | [`ghost-5.x-email-adapter-wiring.patch`](patches/ghost-5.x-email-adapter-wiring.patch) | `test/integration/ghost-5.sh` |

Both versions need their matching patch until Ghost core ships third-party email adapter wiring. Other Ghost 5.x releases have not been verified; re-run the Ghost 5 disposable check against the exact version before using the patch. Re-run the matching disposable check before every Ghost upgrade.

## Install on Ghost 6.x

This interim setup uses the bundled wiring patch because stock Ghost does not yet resolve email adapters. The patch was last verified against the **v6.53.0** runtime embedded in `ghost:6-alpine`; re-run the disposable integration check before applying it to an updated Ghost runtime.

1. Apply [`patches/ghost-6.x-email-adapter-wiring.patch`](patches/ghost-6.x-email-adapter-wiring.patch) from the running Ghost runtime directory (`/var/lib/ghost/current` in the official image):

   ```bash
   cd /var/lib/ghost/current
   git apply /path/to/ghost-6.x-email-adapter-wiring.patch
   ```

2. Install the adapter using one discovery method.

   **npm alias** — run this from the Ghost installation root (the directory containing `current/`). The alias makes the package resolvable as the configured `ses` adapter:

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
           "configurationSet": "ghost-newsletter",
           "accessKeyId": "AWS_ACCESS_KEY_ID",
           "secretAccessKey": "AWS_SECRET_ACCESS_KEY"
         }
       }
     }
   }
   ```

   `accessKeyId` and `secretAccessKey` are optional credentials. Prefer the AWS SDK default credential provider chain: omit both keys and supply an IAM role, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables, or another supported AWS credential source. Never commit real credentials to Ghost configuration.

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

SES account-level suppression-list support is not implemented; it is tracked in [#8](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues/8).

## Credits

The provider implementation is ported from the excellent work by [**@danielraffel**](https://github.com/danielraffel) in [TryGhost/Ghost#25367](https://github.com/TryGhost/Ghost/pull/25367) (MIT). This repo packages and maintains it as a standalone module.

## License

MIT
