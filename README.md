# ghost-ses-email-adapter

Amazon SES bulk email provider adapter for [Ghost](https://ghost.org), packaged as a standalone npm module following Ghost's community adapter conventions (the same pattern as Ghost storage adapters).

> **Status: pre-alpha — under active development.** See the [issues](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues) for the roadmap.

## Why

Ghost's native newsletter bulk-sending only integrates with Mailgun. Amazon SES support was proposed and implemented in [TryGhost/Ghost#25367](https://github.com/TryGhost/Ghost/pull/25367) but closed unmerged — Ghost core prefers a pluggable adapter mechanism with providers maintained by the community:

> "I think having an adapter mechanism would be enough for Ghost core. And self-hosters can use a 3rd party adapter to add SES or other providers to their Ghost sites." — Ghost core team, on #25367

This package is that community-maintained SES provider. Whether you send directly or through a locked-down Lambda for IAM/compliance reasons, it's the most complete SES integration available for Ghost today — newsletter sending with retries and idempotency, SESv2 suppression-list support, and an analytics provider for opens/bounces/complaints, ahead of what any other third-party option offers. (Note: Ghost's `sending-service` currently attaches per-recipient personalization, e.g. the unsubscribe token, to every send, so in practice each recipient is sent individually rather than batched via BCC.)

A companion minimal PR to Ghost core, [TryGhost/Ghost#29553](https://github.com/TryGhost/Ghost/pull/29553), proposes the small wiring change needed for stock Ghost to load third-party email adapters — no bundled SES code, just the adapter-manager hook Ghost core itself asked for. **It's open and awaiting maintainer review; a comment or reaction there directly helps it get traction.** Until it merges, an interim patch (below) enables the adapter on self-hosted installs.

## How

1. Apply the interim wiring patch for your Ghost version (stock Ghost doesn't yet resolve third-party email adapters). This step disappears once [TryGhost/Ghost#29553](https://github.com/TryGhost/Ghost/pull/29553) merges — installing the adapter will then need no patching and no other changes to Ghost core.
2. Install the adapter:

   ```bash
   cd current
   npm install --omit=dev --no-save ses@npm:ghost-ses-email-adapter
   ```

3. Set `adapters.email.active` to `ses` in `config.production.json`, with your SES region, verified sender, and credentials.
4. Restart Ghost.

Full walkthrough, config reference, Docker setup, and the disposable integration checks: **[Installation guide](docs/installation.md)**.

Need SES access walled off behind IAM — a shared platform account, cross-account send, stricter compliance posture? See **[Lambda transport](docs/lambda-transport.md)**: Ghost keeps only `lambda:InvokeFunction`, so `ses:SendRawEmail`, verified identities, DKIM, and sending reputation never have to leave the platform account.

## Supported Ghost versions

| Ghost version | Status | Verified runtime | Interim wiring patch | Disposable check |
| --- | --- | --- | --- | --- |
| 6.x | Supported | `ghost:6-alpine` (v6.53.0) | [`ghost-6.x-email-adapter-wiring.patch`](patches/ghost-6.x-email-adapter-wiring.patch) | `test/integration/ghost-6.sh` |
| 5.130.6 | Supported | `ghost:5.130.6-alpine` | [`ghost-5.x-email-adapter-wiring.patch`](patches/ghost-5.x-email-adapter-wiring.patch) | `test/integration/ghost-5.sh` |

Both versions need their matching patch until Ghost core ships third-party email adapter wiring ([upstream status](docs/installation.md#upstream-status)). Other Ghost 5.x releases have not been verified; re-run the Ghost 5 disposable check against the exact version before using the patch. Re-run the matching disposable check before every Ghost upgrade.

## Documentation

- [Installation guide](docs/installation.md) — install methods, Ghost 6.x/5.x setup, Docker, disposable integration checks, upstream status
- [Local development](docs/local-development.md) — bind-mounted dev workflow against the Ghost monorepo
- [Lambda transport](docs/lambda-transport.md) — send through an IAM-restricted or cross-account Lambda instead of direct SES
- [Analytics setup](docs/analytics-setup.md) — SES → SNS → SQS opens/bounces/complaints provider (not yet wired by Ghost)
- [Suppression provider](docs/suppression-provider.md) — SESv2 account-level suppression list
- [Sender-email verification workaround](docs/sender-email-verification.md) — newsletter `sender_email` stuck as unverified in the Admin UI
- [Changelog](CHANGELOG.md) — release history

## Credits

The provider implementation is ported from the excellent work by [**@danielraffel**](https://github.com/danielraffel) in [TryGhost/Ghost#25367](https://github.com/TryGhost/Ghost/pull/25367) (MIT). This repo packages and maintains it as a standalone module.

## License

MIT
