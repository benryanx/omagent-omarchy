# Contributing to Omagent

Submit focused changes with a clear description of the resulting behavior.
Follow [AGENTS.md](AGENTS.md) and the applicable
[verification recipe](docs/verification/README.md). Use isolated fixtures for
mutations; never test against the user's running app or data.

Run the checks appropriate to the change, including `pnpm typecheck`,
`pnpm check:privacy`, `pnpm check:branding`, and relevant tests. Translation
changes also require `pnpm i18n:check`.

Do not commit credentials, local account settings, or generated packages.
Hosted service defaults must remain disabled until Omagent's own services are
explicitly configured. Worker deployment templates require your own account,
zone, database, OAuth client, and secrets before deployment.

Code contributions use [Apache License 2.0](LICENSE). Preserve original
copyright and third-party notices in [NOTICE](NOTICE). No upstream contributor
agreement is required.
