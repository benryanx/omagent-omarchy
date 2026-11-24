# Linux desktop preview

This repository's packaged preview targets Omarchy / Arch Linux x86_64.
Install instructions and current limitations are in the [README](../README.md).
Use the Arch package for launcher integration, or the AppImage for a portable
build. Both include the local server and browser runtime; Node.js and pnpm are
build dependencies, not application runtime requirements.

Browser automation is available. Direct control of the host desktop is disabled
on Wayland. Cloud hosting, mobile-store applications, automatic updates and
other distribution targets have not been qualified for this preview.

Build with `pnpm package:omarchy`. Package validation must use a disposable home
and profile, following [verification](verification/README.md). Never package a
copy of the maintainer's installed application data.
