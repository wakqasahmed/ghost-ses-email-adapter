# Newsletter sender_email stuck as unverified

Some self-hosted operators have hit Ghost's Admin UI blocking a newsletter test-send with "Please verify your email settings" even though the sending domain is independently verified with SES. See [issue #24](https://github.com/wakqasahmed/ghost-ses-email-adapter/issues/24) for the full investigation.

What we've confirmed against Ghost core source: the verification-required gate (`services/email-address/email-address-service.ts`) is controlled by `hostSettings:managedEmail:enabled`, a Ghost(Pro) managed-hosting flag — **not** anything Mailgun-specific. It defaults to `false` for self-hosted installs, and when it's `false`, `sender_email` changes apply immediately with no verification step. If you hit this block, first check whether that flag is unexpectedly set in your config, and whether your Admin API token actually has permission to update newsletters (a separate, unrelated permission-allowlist gap can produce similar symptoms).

If you still need a direct fix, [`scripts/set-newsletter-sender-email.js`](../scripts/set-newsletter-sender-email.js) sets a newsletter's `sender_email` straight in Ghost's database — a safer, dry-run-by-default replacement for hand-written SQL. It reuses Ghost's own installed `knex` and database driver, so it adds no dependencies of its own. Run it from the Ghost installation root — the directory containing both `config.<env>.json` and `current/` (a standard Ghost install keeps `node_modules` inside `current/`, separate from the config file; the script checks both locations automatically):

```bash
node /path/to/set-newsletter-sender-email.js --newsletter default-newsletter --sender-email news@example.com
# prints what would change; add --yes to apply
```

Pass `--ghost-dir path` to point at the installation root explicitly if you're running the script from elsewhere, or `--config path` to use a config file outside that directory.

It writes only the `sender_email` column and skips Ghost's own format validation — confirm the address is correct and verified with your bulk email provider before applying.
