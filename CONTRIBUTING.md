# Contributing

## Release intent

Every pull request that changes publishable package files must include a
Changeset. Run `npx changeset`, select `ghost-ses-email-adapter`, choose the
appropriate semantic version bump, and commit the generated file under
`.changeset/`.

For changes that intentionally do not require an npm release, request the
`no-changeset` pull request label from a maintainer and explain why in the PR.
The CI release-intent check accepts the label for tests, CI, documentation, and
other internal-only changes when a release is not appropriate.

After a Changeset PR merges, the Release workflow opens or updates a Version
Packages PR. Review and merge that generated PR to trigger npm publication.
