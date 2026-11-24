# Omarchy preview releases

The public repository is `benryanx/omagent-omarchy`. The original development
repository and its personal profiles are separate. This repository has no
legacy release mirror, subscription service or upstream publishing credentials.

A release contains the source at its tag, a Linux x86_64 AppImage, an Arch
`.pkg.tar.zst` package, `SHA256SUMS`, and release notes listing known limitations.
Mark preview releases as prereleases. Do not claim an official Omarchy package
until its maintainers accept a package recipe.

## Prepare

1. Commit the intended source, including the dependency lockfile and notices.
2. Run the secret scan against the source snapshot. Review new findings; never
   add a broad test-directory exclusion. Keep real credentials and reports
   outside the repository.
3. Run lint, typecheck, privacy/branding checks and the relevant verification
   fixtures. All mutation tests use disposable homes and data directories.
4. Run `pnpm package:omarchy` from a clean checkout. Build resources contain
   code, pinned runtimes and license notices, never a user profile or `.env`.
5. Inspect the packaged file list for credentials, browser state, logs, databases
   and conversations. Launch the package with a disposable home and verify
   first-run setup, no Telegram binding and no Agentcard credentials.
6. Check the desktop entry, browser, theme following and application exit.
   Record any unsupported platform behavior explicitly.

## Publish

Tag the verified commit and create a GitHub prerelease. Attach only the audited
application artifacts and their SHA-256 checksums. Source archives are provided
by GitHub for the tagged commit. Do not upload developer profiles, verification
reports containing user data, local logs or build caches.

The first release targets Omarchy / Arch Linux x86_64. Other platform code and
historic verification documents remain in the source; they are not a claim
that this preview has been qualified for those platforms.

For Omarchy's package repository, prepare a pinned `PKGBUILD` and
`.omarchy/package.json` under `pkgbuilds/omagent/` in a contribution to
https://github.com/omacom/omarchy-pkgs. Follow that repository's current review,
architecture and checksum requirements. Submitting a package is separate from
publishing GitHub download artifacts.

Automatic app updates remain disabled. The release workflow must never mirror
to another repository or publish npm, Docker, mobile or hosted-service releases.
