# Omagent on Omarchy

Omagent is a local-first, tracking-free workspace for teams of AI agents.
It includes browser and computer backends, conversations, routines, connected
tools, and provider CLI support.

No product analytics SDK is shipped. Model providers and explicitly configured
integrations receive the data required to perform requested work.
Run `pnpm check:privacy` and `pnpm check:branding` before packaging.

The desktop target is Arch Linux with Hyprland/Wayland. Browser automation and
isolated computer backends remain available. Direct host control requires a
verified Wayland input and capture boundary on Omarchy.

Subscription cloud hosting is future work. No upstream account, billing,
connected-app broker, or update service is used by default.
