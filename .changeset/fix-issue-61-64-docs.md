---
"ghost-ses-email-adapter": patch
---

Correct stale AGENTS.md (issue #8 became the suppression provider, not 5.x compatibility; note the patch's looser embedded EmailProviderBase contract as a follow-up bundled with #55), document that errorHandler has no effect via the interim wiring patch's AdapterManager instantiation path, and add docs/examples/CHANGELOG.md to the npm files whitelist so README-referenced doc links resolve for content-adapter installs extracted from the tarball.
