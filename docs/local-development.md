# Local development with the Ghost monorepo

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
