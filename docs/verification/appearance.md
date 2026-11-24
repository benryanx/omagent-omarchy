# Appearance and Omarchy theme following

Run the native acceptance check:

```sh
node --experimental-strip-types scripts/verify-appearance.ts
```

It launches the control surface's fake-engine fixture to obtain a sealed
configuration, then starts the production development desktop in a disposable
home and profile. Its palette files, agents, browser session, settings and
screenshots belong to that fixture. The user's desktop theme and workspace
are untouched.

The real preload, server and appearance components prove:

- All six primary, four animal and seven festive shapes save through the profile API.
- A selected festive shape survives reload.
- Festive dress-up is opt-in, survives reload, and restores the saved shape
  when switched off without rewriting the profile.
- Halloween choices are hidden; saved Halloween looks remain supported.
- New agents start with the exact Omarchy mark.
- Omarchy following is the default when the desktop exposes an active palette.
- Existing desktop profiles migrate from older manual choices to following
  once; subsequent explicit manual choices remain pinned.
- Original app themes live in the separate, collapsed Legacy section.
- Replacing the active palette changes UI and mascot colours without reload.
- Selecting a bundled palette pins it through desktop changes and reload.
- Selecting Omarchy again resumes following the latest desktop palette.

The command prints its evidence directory, containing a screenshot, JSON
receipt and desktop logs, then shuts down its desktop and server. It exercises
the real appearance components in a dedicated fixture page; it does not drive
the main Settings navigation.

Additional checks:

```sh
node --test electron/omarchy-theme.node-test.mjs electron/preload-contract.node-test.mjs
pnpm exec vitest run src/lib/omarchy-theme.test.ts src/lib/festive-dress.test.ts src/lib/skins.test.ts src/lib/skins.default.test.ts electron/skin-overlay.test.mjs shared/bot-body.test.ts server/bot-look.test.ts server/bot-profile.test.ts src/components/Avatar.test.ts src/components/BotProfileAvatarCard.test.ts
pnpm check:contrast
pnpm typecheck
pnpm lint
```

The original body catalog remains readable for saved agents. The six primary
choices are exported by `shared/omagent-bodies.ts`; a selected older body stays
available in its editor. The supplied SVG is retained in
`public/omarchy-logo.svg`, and the avatar test checks its exact path.

The seasonal collection lives in `shared/festive-bodies.ts`. Dress-up maps
colour roles to temporary bodies in `src/lib/festive-dress.ts`; it keeps
explicit festive, Halloween, silver and chrome looks. Switching it off clears
only the local preference and never patches saved agents.

Bundled theme data lives in `src/lib/omarchy-palettes.ts`. After updating it,
run `pnpm gen:omarchy` to regenerate CSS and native window colours. Active
desktop palettes are read from the current Omarchy state directory, with the
older config-directory location supported as a fallback. A missing or invalid
replacement retains the last valid palette.

The animal collection lives in `shared/animal-bodies.ts`. Kitten uses its own
persisted ID so existing Halloween cats retain their original look. Santa is
a festive silhouette with a theme-coloured hat, pale trim and a beard; all
new looks reuse the animated face and existing colour preferences.
