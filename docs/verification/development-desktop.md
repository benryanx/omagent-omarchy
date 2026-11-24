# Development desktop and workspace import

Run the profile, source-entry, session-boundary, and live SQLite backup checks:

```sh
node --test electron/development-profile.node-test.mjs electron/server-session.node-test.mjs electron/server-child-launch.node-test.mjs
python3 scripts/import-dev-profile.test.py
pnpm typecheck
pnpm lint
```

The import test keeps a source SQLite database open in WAL mode, backs it up,
checks the committed conversation in the destination, and confirms that the
source database and WAL bytes were not changed. The shared-memory lock file may
change while SQLite coordinates the read. It also checks that bots, settings,
and project paths survive, engine sessions are reset, and copied routines pause.

For native acceptance, use a temporary development root and home containing only
the fake engine configured by the control fixture. Launch
`scripts/omagent-dev.mjs` with a separate `--debug-port`, inspect its loopback CDP
page, and create a disposable bot through the real renderer's API connection.
Check the 201 response, native preload bridge, separate window identity, and
`electron/dev-server-entry.mjs` in the owned server log. Capture a screenshot and
a JSON receipt. Close that desktop and confirm its server and Vite process exit.
Never exercise mutations against the everyday app or an imported user workspace.

The development proxy receives the desktop owner header only for API routes in
the exact configured loopback origin, via Electron's private default session.
Other sessions cannot access either that proxy or the owned server. The owner
capability is never handed to renderer JavaScript or written into Vite config.
A normal browser must pair independently; do not enable blanket browser trust.

User setup import runs once into an empty Dev workspace. Its snapshots and
receipts live outside the repository under the development root. After launch,
read-only counts can confirm the imported agents and messages. Scheduled
routines, background memory work, device sessions, and sharing grants remain
separate. Existing model-provider CLI sign-ins belong to the operating-system
user, and external project folders are not copied or sandboxed by this importer.
