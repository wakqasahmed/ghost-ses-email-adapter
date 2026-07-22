# ghost-ses-email-adapter

Amazon SES bulk email provider adapter for [Ghost](https://ghost.org), packaged as a standalone npm module following Ghost's community adapter conventions (the same pattern as Ghost storage adapters).

> **Status: pre-alpha — under active development.** See the [issues](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues) for the roadmap.

## Why

Ghost's native newsletter bulk-sending only integrates with Mailgun. Amazon SES support was proposed and implemented in [TryGhost/Ghost#25367](https://github.com/TryGhost/Ghost/pull/25367) but closed unmerged — Ghost core prefers a pluggable adapter mechanism with providers maintained by the community:

> "I think having an adapter mechanism would be enough for Ghost core. And self-hosters can use a 3rd party adapter to add SES or other providers to their Ghost sites." — Ghost core team, on #25367

This package is that community-maintained SES provider. A companion minimal PR to Ghost core (tracked in this repo's issues) proposes the small wiring change needed for stock Ghost to load third-party email adapters; until it lands, an interim patch (documented here) enables the adapter on self-hosted installs.

## Install

The adapter is not yet functional; provider implementation and the interim Ghost wiring patch are tracked separately. This is the intended installation shape once they are available:

```bash
npm install ghost-ses-email-adapter
```

Install the package in the Ghost installation so Ghost can discover it as the `ses` email adapter.

## Configuration

After applying the documented Ghost email-adapter wiring patch, configure SES in Ghost's config file:

```json
{
  "adapters": {
    "email": {
      "ses": {
        "region": "eu-west-1"
      }
    }
  }
}
```

Use your deployment's normal AWS credential mechanism; never place AWS access keys in Ghost's config. Complete option and credential documentation will ship with the wiring patch.

## Credits

The provider implementation is ported from the excellent work by [**@danielraffel**](https://github.com/danielraffel) in [TryGhost/Ghost#25367](https://github.com/TryGhost/Ghost/pull/25367) (MIT). This repo packages, maintains, and extends it (analytics, suppression support) as a standalone module.

## License

MIT
