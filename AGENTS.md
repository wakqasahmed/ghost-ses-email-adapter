# ghost-ses-email-adapter — Agent Context

## What this project is

A standalone npm package providing an **Amazon SES bulk email provider adapter for Ghost**, following the same community-adapter conventions as Ghost storage adapters (e.g. `ghost-storage-adapter-s3`): installable via npm / copyable into `content/adapters/email/ses/`, configured via Ghost's `adapters.email` config block.

## Critical architectural facts (verified against Ghost source — do not re-derive)

1. Ghost's `AdapterManager` (`ghost/core/core/server/services/adapter-manager/`) loads third-party adapters from `node_modules` and `content/adapters/` — this mechanism ships in stock Ghost today and is how storage adapters work.
2. **However**: stock Ghost's `EmailServiceWrapper` (`ghost/core/core/server/services/email-service/EmailServiceWrapper.js`) hardcodes `MailgunEmailProvider` and never consults the adapter manager for an `email` adapter type. Until a small upstream wiring change merges into Ghost core, this package cannot activate on stock Ghost — users need the interim wiring patch this repo documents (issue #3), and the long-term fix is the upstream PR (issue #5).
3. TryGhost maintainer position (from closed PR TryGhost/Ghost#25367 comments, verbatim): *"I don't think Ghost needs to have AWS SES adapter built-in… I think having an adapter mechanism would be enough for Ghost core. And self-hosters can use a 3rd party adapter to add SES or other providers to their Ghost sites."* — i.e., a minimal adapter-mechanism PR is aligned with what core says they'd accept; a bundled-SES PR is not.
4. The provider implementation is **ported from TryGhost/Ghost PR #25367 by @danielraffel** (closed unmerged; MIT-licensed contribution). Original author MUST be credited in README and package.json `contributors`. The port source (605-line provider + 613-line/36-case test suite) is saved at:
   - `/opt/OSS-contributions/tryghost-ghost/ses-provider.js`
   - `/opt/OSS-contributions/tryghost-ghost/ses-test.js`
   - Full Ghost source clone for reference: `/opt/OSS-contributions/tryghost-ghost/` (branches `pr-25250`…`pr-25367` contain the related PR chain).
5. The related PR chain context: #25250 (EmailProviderBase foundation), #25251 (EmailServiceWrapper wiring — the essence of our upstream PR), #25252 (analytics adapter), #25253 (suppression adapter) — all closed unmerged. PR6 (#25365) *claimed* SQS analytics but its diff contains **no analytics implementation** (only docs + an admin-UI label fix); do not treat its description as evidence the work exists.

## Version targets

- **Primary: Ghost 6.x** (current major; upstream PR target).
- Ghost 5.x compatibility is **backlog** (issue #8), not in scope for initial issues. Note 5.x uses `services/email-service/MailgunEmailProvider.js` (capitalized filenames) vs 6.x `mailgun-email-provider.js` — the wiring differs between majors.

## Testing conventions

- Unit tests: port the 36-case suite; framework should match Ghost's (mocha/should/sinon) for upstream portability.
- Integration test: run against a **disposable `ghost:6-alpine` Docker container** with the wiring patch applied + this package installed. Never test against any running staging/production Ghost container on this host. Clean up containers after.
- SES calls in tests: mocked (aws-sdk-client-mock or sinon). Real-send smoke test is manual/documented, not CI.

## Repo conventions

- MIT license. Node >= 20. Package name: `ghost-ses-email-adapter`.
- Dependency: `@aws-sdk/client-ses` (regular dep here, unlike the optional-dep approach in the original PR).
- Release management: changesets (`@changesets/cli`) — see issue #7.
- Conventional, narrowly-scoped commits. No AI attribution in commit messages.
- Branch per issue: `feature/issue-N-short-desc`. PRs to `main` (no staging branch in this repo).
- Never commit secrets. AWS credentials in tests must be obvious fakes.
