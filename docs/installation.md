# Installation

## Choose an installation method

**Recommended for deployments: install the npm package.** It gives Ghost a
versioned adapter dependency and does not require this repository to remain on
the host:

```bash
cd current
npm install --omit=dev --no-save ses@npm:ghost-ses-email-adapter
```

The `ses` alias must match `adapters.email.active`. See [Install on Ghost
6.x](#install-on-ghost-6x) below for the matching configuration and production
setup.

**Use a source checkout only for local adapter development.** See
[Local development](local-development.md) — it bind-mounts this repository
into a Ghost dev container so code changes are available immediately. It is
not the recommended production installation method.

## Install on Ghost 6.x

This interim setup uses the bundled wiring patch because stock Ghost does not yet resolve email adapters. The patch was last verified against the **v6.54.0** runtime embedded in `ghost:6-alpine`; re-run the disposable integration check before applying it to an updated Ghost runtime.

1. Apply [`patches/ghost-6.x-email-adapter-wiring.patch`](../patches/ghost-6.x-email-adapter-wiring.patch) from the running Ghost runtime directory (`/var/lib/ghost/current` in the official image):

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

   `transport` defaults to `direct`. For IAM-restricted or cross-account SES, set it to `lambda` and add `lambda.functionName`; `lambda.region` is optional and falls back to `ses.region`. See the [Lambda transport walkthrough](lambda-transport.md).

   Create the four SES configuration sets shown above. Their event destinations must respectively publish open-and-click, open-only, click-only, and no open/click events. The adapter selects the matching set for Ghost's `openTrackingEnabled` and `clickTrackingEnabled` flags. A legacy `configurationSet` remains supported only when both flags are enabled; configure a `disabled` set to make opt-outs explicit.

   Ghost retries a failed provider `send()` call for the entire provider batch, so this adapter advertises one recipient per batch. The adapter coalesces concurrent identical sends and retains successful recipients and bulk batches during an in-process retry. It identifies retries by Ghost's `emailId`, a caller-provided `idempotencyKey`, or an identical send payload. Retry state is capped at 1,000 keys (oldest first) to bound memory and in-process recipient-data retention. This protection is not durable across process restarts; callers needing durable idempotency must provide it outside the adapter.

   The constructor also accepts an optional `errorHandler` callback for forwarding send failures to an external error tracker (e.g. Sentry). This has **no effect** when installed via the patch and `config.production.json` above — the interim wiring patch instantiates the adapter purely from JSON config through `AdapterManager`, which has no mechanism to inject a JavaScript function. `errorHandler` is only usable if you instantiate `SESEmailProvider` directly in your own code instead of relying on the patch's AdapterManager wiring.

4. Restart Ghost after applying the patch, installing the adapter, and updating configuration.

### Docker

Build a derived image so the patch and adapter are present on every container start. The following Dockerfile assumes this repository is the build context:

```dockerfile
FROM ghost:6.54.0-alpine

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

Ghost 5.130.6 uses the same adapter configuration and installation methods as Ghost 6, but its runtime files have different casing and adapter registration. Apply [`patches/ghost-5.x-email-adapter-wiring.patch`](../patches/ghost-5.x-email-adapter-wiring.patch) from `/var/lib/ghost/current`, then complete steps 2–4 in the Ghost 6 instructions above. Re-validate the patch against the exact runtime before using it on another Ghost 5.x release.

Run the matching disposable check before using the patch:

```bash
test/integration/ghost-5.sh
```

It prints the following marker after Ghost starts and the patched email service wires the SES provider into `SendingService`:

```text
EMAIL_PROVIDER=SESEmailProvider
```

## Upstream status

This patch is temporary. It becomes unnecessary after [TryGhost/Ghost#29553](https://github.com/TryGhost/Ghost/pull/29553) — the upstream adapter-wiring PR tracked by [issue #5](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues/5) — is merged and released; once it ships, installing this adapter needs no patching and no other changes to Ghost core. The PR is open and awaiting maintainer review — comments or reactions there help it get considered. It was last verified against the embedded Ghost v6.54.0 runtime; re-run the integration check before every Ghost upgrade.
