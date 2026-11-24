# Preview 0.1.0-preview.1 validation

This public repository is a new source snapshot of the Omarchy adaptation.
The original development repository, commit history, personal progress notes,
local credentials and user profiles were not imported. Original notices and
third-party licenses are retained; the Omarchy artwork/license is credited.

Checked locally before publication:

- Frozen dependency install and complete desktop build.
- TypeScript checks, lint, branding, privacy and locale validation.
- 133 focused tests covering Telegram identity and permissions, guarded sends,
  provenance, Agentcard checkout and receipts, browser input recovery,
  Omarchy appearance and mascot shapes.
- Nine native theme, preload-contract and screen-status checks.
- The appearance fixture saves 17 shapes and checks persistence, opt-in
  festive looks, live palette changes, manual overrides and reload.
- A fresh packaged application home with provider CLIs excluded opens provider
  setup. Telegram is unconfigured/unpaired and Agentcard is unconfigured.
- The same clean-start check succeeds through the AppImage runtime.
- Gitleaks 8.30.1 scans the source snapshot, including tests. Exceptions are
  limited to generated translation hashes and exact synthetic fixture values.
  A new synthetic secret in a test file is still detected.
- Arch package generation uses makepkg, a checksum-verified local payload,
  declared runtime dependencies and preserved vendor binaries. It does not
  depend on electron-builder's bundled Ruby/FPM runtime.

The package list is checked for local state such as credentials, Telegram
bindings, browser cookies, chats, logs and databases. The installed application
includes code, static assets, pinned runtimes and license notices. All published
artifacts have SHA-256 checksums. Public CI rechecks the source independently.

This is not a claim that every inherited test or platform was qualified. Direct
host control on Wayland is disabled. Payments remain experimental, retain
Agentcard authorization, and are never considered successful without merchant
confirmation. The maintainer's live browser and payment accounts were not used
for release verification. No production purchase was made.
