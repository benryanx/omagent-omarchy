# Telegram and AgentCard setup

Settings → Messaging & payments is available in Simple and Advanced views.

## Telegram

1. Create a bot with `/newbot` in Telegram's official `@BotFather` account.
2. Paste its token into Omagent's password field, select an Omagent bot and
   connect. An existing webhook is refused rather than removed.
3. Create a pairing link, open it in your own Telegram account and press
   Start. The link expires after ten minutes and can pair only one private
   account. Do not share it.
4. Send text. The bridge creates a dedicated Telegram conversation on the
   selected bot with Ask permissions. Later messages honor Ask or Full access
   selected for that conversation in Omagent. Each request retains its permission
   snapshot across retries; a changed permission level is refused before starting.
   Other permission modes require selecting Ask or Full access in Omagent.
   `/status` reports the request and
   `/stop` targets only its fenced execution. The Stop button in settings also
   works when Telegram is offline. Messages verified against the bridge's
   pending receipt from your paired private account are your own instructions,
   including purchase confirmations. Generic relays remain information only;
   claiming the name “Telegram owner” never establishes identity. Review tool
   approval cards and questions in Omagent; Telegram does not answer those
   cards or replace Agentcard's passkey approval.

The server polls Telegram over HTTPS; it needs no public inbound port.
Omagent must stay running. The first version supports one Telegram bot,
one paired owner, one selected Omagent bot and private text messages only.
Shared/team workspaces are not supported. Changing the selected bot starts
a new Telegram conversation; changing the token requires pairing again.

The token, binding, update cursor and pending request live in `telegram.json`
under the data directory, with mode `0600`. Status responses omit the token,
and portable backups exclude this file and its temporary writes. Disconnect
erases the stored connection after its request finishes or is stopped.

Updates are consumed before acting and replies are marked before delivery.
This favors avoiding repeated agent actions or duplicate replies over replay
after a crash or ambiguous network failure: a message or reply can be lost.
Review the Telegram conversation in Omagent before resending a purchase or
other consequential request. Accepted sends use a stable id and the guarded
route; retries cannot become a fresh ordinary send, queue or steering action.
Request results come only from that guarded request's confirmed terminal
reply, never whichever bot message happens to be latest.

## AgentCard

The setup page reuses the existing personal OAuth connector at
`https://mcp.agentcard.sh/mcp`. Connect with your own account, then select
Bot access on its card. Card entry and purchase approval remain on
AgentCard's hosted pages. Omagent does not collect card details in this setup.

The [current getting-started guide](https://docs.agentcard.com/getting-started)
also describes developer Vault and Issuing integrations. The separate
[Commerce MCP API](https://docs.agentcard.com/commerce-mcp) uses
`https://mcp.opencommerce.sh/mcp` and client credentials, rather than this
personal OAuth flow. Its developer setup is linked separately. No developer
Commerce credential handling, browser payment interception or card issuing
is implemented by this initial connector change. The separate project Vault browser
checkout added later is documented in [Agentcard Vault checkout](agentcard.md).

## Isolated verification

```sh
pnpm exec vitest run server/telegram.test.ts server/telegram.e2e.test.ts server/workspace-backup-policy.test.ts src/components/IntegrationsSettings.test.ts src/components/SettingsModal.simple.test.ts src/components/McpServersPanel.hosted.test.ts
node --experimental-strip-types scripts/verify-integrations.ts
pnpm typecheck
pnpm lint
pnpm i18n:check
pnpm build
```

The HTTP fixture launches the prescribed fake-engine server and the actual
bridge with a fake Telegram transport. It pairs, accepts a Telegram message
through the real guarded route, stores its transcript and sends its confirmed
answer back through the fake transport. It also selects Full access, checks a
second reply, and verifies that a permission change before admission prevents
the next message from starting. Its evidence stays beside the server
log as `.telegram.json` and contains no real credentials.

The message-route fixture also drives a real paired bridge through the guarded
HTTP route and checks that its message has owner authority. It verifies that
generic relays retain the information-only label and that altered text, bot,
thread, request ID, branch or permission snapshots cannot inherit the paired
owner's authority. No payment or merchant request is made.

The native fixture launches real Electron/preload in a disposable home. It
checks the setup fields, no-token Connect state, actual secret-free status
route, AgentCard card and documentation links, and a 390px layout. Screenshots,
receipt and logs remain in its printed evidence directory. It never connects
Telegram, signs into AgentCard or makes a purchase. Personal OAuth behavior is
covered by the existing hosted MCP connector fixtures; no live account or
real Telegram delivery is established by these tests.

## User acceptance on 24 November 2026

The user confirmed that real Telegram testing and message delivery are working.
This is user-reported acceptance in addition to the isolated checks above.
The bridge still requires Omagent to remain running.
