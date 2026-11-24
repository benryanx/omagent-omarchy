# Agentcard Vault browser checkout

Enter your project Client ID and Client secret in Settings → Messaging & payments →
Agentcard Vault checkout. The Copy button in Agentcard returns two environment
assignments; pasting those into either field fills both values. Save and verify
checks the credentials, encrypts them in `agentcard-credentials.json.enc` under
an owner-only `agentcard-credentials-key`, and activates them without restarting.
Only an administrator may configure the project. Neither values nor the key
are returned to the UI, shared with bots, or carried in portable backups.

The server also accepts `AGENTCARD_CLIENT_ID` and `AGENTCARD_CLIENT_SECRET` from
its environment. Environment credentials take precedence and are managed there.
Vault credentials are separate from the optional personal Agentcard MCP
connector. Use Sandbox credentials for the first rehearsal. Vault identities
are scoped to the project client so Sandbox and Production do not share user
mappings. Changing credentials is refused during an unresolved checkout.
Never paste credentials or card details into a conversation.

Settings → Messaging & payments → Agentcard Vault checkout creates an
enrollment session for the authenticated person. Its exact private URL opens
in that person's browser. Session polling honors Agentcard's interval and
persists only the verified mapping from the app person to the Vault user.
Card display fields come from the authenticated Vault cards endpoint. An
existing linked user can add another card without replacing their identity.

Before creating a link, Omagent re-reads the user's stored cards. A returning
user with a card gets no new enrollment link. An empty Vault or a 404 company
connection can enroll; other API errors stop the request. Initial and add-card
sessions are open sessions, with no `user_id` parameter. Add-card sessions send
`steps: ["card"]` and the same stable `external_user_id`. The UI distinguishes a
linked account with no stored card from a Vault that is ready to pay. Purchases
also recheck cards rather than trusting the display cache.

The `agent_browser_checkout` tool requires a turn provably acting for one
person. Its `prepare` action takes an HTTPS merchant URL, integer amount in
minor units and currency. It attaches interception before navigating a new
isolated context inside the existing Chromium. The native engine uses the
SDK's direct CDP adapter; the older engine exposes its existing local CDP
endpoint to Playwright Core. Neither path installs or starts another browser
provider. The older engine returns `browserControl: checkout`; the agent must
use the checkout tool's `browse` action for that context, including `frame`
selectors for hosted payment fields.

The agent receives Stripe's published placeholder `4242424242424242`, expiry
`12/40`, CVC `123`. It never receives the user's PAN or approval URL. Approval
links appear in the authenticated app banner and Vault settings. The person
opens them in their own browser and approves with their passkey. Agentcard
substitutes their real card outside the model process. A changed total needs
a new approval; no automatic payment retries are implemented.

After submission, call `reconcile`. Payment approval alone is insufficient.
The merchant resolver reads a structured Order record on the exact HTTPS
merchant host, including order number, fulfilled/processing status, amount and
currency. For sites without structured order data, `reconcile` accepts CSS
selectors in `receipt: { order, status, total }`. These read the merchant's
current visible receipt; the total must include its ISO currency code and match
the approved amount. Missing, pending, conflicting or unreadable evidence
remains unknown. Report an order placed only for `status: completed` and
`merchantConfirmed: true`. Redirected confirmation hosts require manual
merchant verification; they cannot silently confirm a different merchant.

Enrollment links and live checkout attachments remain in memory. Restarting
Omagent loses those attachments; verify any interrupted purchase directly
with the merchant before starting another. Cancelling never reverses a charge.
Vault user mappings are excluded from portable backups. The desktop's private
route gate and each hosted user's session protect approval responses; tool
results and conversation events do not carry those capabilities.



## Browser checkout routing

For a card stored through Omagent's project Vault, the agent checks
`agent_browser_checkout` with `action: "cards"`. Its metadata response contains
brand, last four digits and expiry only, with no Vault user id, card id,
enrollment URL or approval URL. The personal Agentcard MCP connector is a
separate account; its `list_cards` result is not used for this Vault. Both the
browser system prompt and MCP initialization instructions explain that route.

The legacy browser checkout path passes `browserRuntimeEnv(spec.env)` when
looking up the running daemon's CDP endpoint. A spawn spec omits OS plumbing;
without HOME, runtime/socket and temporary directories the lookup can search
a different daemon directory and fail to find the already-running browser.
The regression runs the installed legacy engine in an isolated home and socket
directory, opens checkout through the actual browser host, attaches the real
SDK, and verifies the original browser still works after checkout closes.

Setup failures name the stage and preserve the fact that the card lookup
succeeded. They do not expose raw transport errors or tell the agent to add a
card after a browser-connection failure. Preparing a USD 5.83 checkout uses
`amount: 583`, plus `currency: "usd"` and the merchant HTTPS URL. Chat approval
is separate from Agentcard's private payment approval.

## Enrollment code and identity storage

The enrollment audit changes these files:

- `server/agentcard.ts`: fresh stored-card checks, 404 recovery, open enrollment
  sessions, polling and the persisted user mapping.
- `server/routes/agentcard.ts`: authenticated connect/add intent validation.
- `src/components/AgentcardVault.tsx` and `src/locales/en.json`: private setup
  links and separate linked-but-empty, ready, and add-card UI states.
- `server/agentcard.test.ts`, `server/agentcard.e2e.test.ts`, and
  `src/components/AgentcardVault.test.ts`: returning users, error handling,
  stable identity and the second-card flow.
- `docs/verification/agentcard.md`: contracts, evidence and limits.

Credentials come from the existing encrypted `AgentcardCredentialsStore`, or
operator-provided environment credentials. A validated session's `user_id` is
saved in `agentcard-vault.json` against a hash of the project Client ID and the
harness-authenticated person. Every card lookup and purchase resolves that same
mapping. Rotating a secret with the same Client ID preserves the mapping;
a different Client ID has a separate mapping.

Links reach the person through the signed-in app's Vault settings. Code places
the exact returned URL in an external-browser anchor; the language model does
not compose it. This installation uses authenticated polling because it has no
public webhook endpoint. Card numbers and passkey enrollment remain entirely
on Agentcard's page in the person's own browser.

## Offline verification

Run from the repository root:

```sh
pnpm exec vitest run server/agentcard.test.ts server/agentcard.e2e.test.ts src/components/AgentcardVault.test.ts src/components/IntegrationsSettings.test.ts
OMAGENT_CDP_CHROME=/usr/bin/chromium OMAGENT_VERIFY_BROWSER_BINARY=/path/to/agent-browser pnpm exec vitest run server/browser/agentcard.e2e.test.ts
node --experimental-strip-types scripts/verify-integrations.ts
pnpm typecheck
pnpm lint
pnpm i18n:check
pnpm build:server
```

The host fixture has no Agentcard credentials. The browser fixtures use fresh
temporary profiles, mocked SDK authorization and a loopback merchant/processor.
They prove actual SDK interception across a cross-origin payment iframe,
private approval delivery, delayed replay, mandatory merchant reconciliation,
and preservation of the existing browser when checkout disconnects. No real
Vault, passkey approval, production card or purchase is exercised.

For a live rehearsal, use separate sandbox credentials and Agentcard's
`https://shop.agentcard.sh` test store, following the upstream Vault quickstart.
Production credentials can place real orders and must not be used by these
automated fixtures.

Upstream contracts:

- https://docs.agentcard.sh/vault/integrations/agent-browsers/your-own.md
- https://docs.agentcard.sh/vault/adding-a-card.md
- https://docs.agentcard.sh/vault/quickstart.md
- https://docs.agentcard.sh/vault/checking-for-stored-cards.md

## Enrollment audit evidence

The real Agentcard API was queried with the saved project credentials, without
creating sessions or payments. Its unknown-user response confirmed Sandbox
mode; the saved owner mapping resolved to a stored Visa ending 4242. The user
also completed enrollment on their iPhone and supplied a screenshot of the
Sandbox card list. This verifies the first card against the real service. A separate read-only
fixture copied only the user mapping into a disposable directory, used the
saved credentials in memory, and blocked every remote mutation except token
exchange. Calling normal enrollment re-read the real card list, returned no
setup link and created zero sessions. Evidence is retained locally in
`/tmp/omagent-agentcard-sandbox-readonly.json` without credentials or raw card data.

The isolated HTTP fixture verifies first enrollment, persistence of `user_id`,
returning-user reuse with no new session, and an explicit second-card session
that preserves the same user mapping. It uses a loopback API stand-in and does
not exercise a real passkey. A second-card passkey ceremony against the real
Sandbox remains a manual check. Production credentials are not selected or
changed by the audit.

## Checkout setup regression evidence

The failed purchase attempt used the project Vault browser tool, whose setup
failed while locating the browser, and then the separate personal connector's
`list_cards`, which returned an empty personal account. The latter does not
establish that the project Vault is empty.

An isolated daemon probe using the installed legacy engine found a valid CDP
endpoint with its full OS environment, and no endpoint after omitting its
runtime/socket directory. Endpoint reads now use the existing daemon relay,
which resolves its socket using the ordinary browser OS environment and avoids
a launch-bearing CLI command. The regression through that actual host armed
the real SDK in a fresh context and left the original browser operational.

A read-only check with the saved Sandbox credentials also found the stored
card and prepared an isolated SDK checkout context at 583 minor units. Its
merchant document was fulfilled locally and no payment request was sent.
The SDK's registry authentication and registry read were separately confirmed
to return HTTP 200. The Sandbox purchase itself still requires the person's
private approval and merchant reconciliation; these checks do not claim an
order was placed.

Browser recovery regression (2026-11-22): the live retry found the saved card,
but a CLI endpoint lookup could replace the Chromium launched by MCP. Checkout
now obtains `cdp_url` from the existing daemon HTTP relay without launch flags.
The real legacy-host fixture interleaves an ordinary MCP call with checkout
reads/clicks and verifies that its isolated tab survives. The fixture also
rejects an ambiguous two-button selector without clicking, then follows the
unique selector from the page description successfully. Checkout browser work
uses the runtime's action guard and refreshes its idle timer.

An idle shopping page is not reconciled as a submitted payment. It stays idle
and can be continued or explicitly cancelled through the SDK. Tests prove that
SDK cancellation permits a fresh attempt only when it returns cancelled;
cancellation after authorization keeps an unknown outcome blocked. Browser
action errors return bounded recovery guidance without raw browser errors or
private approval URLs. No real payment is made by these fixtures.

Paid demo receipt regression (2026-11-22): the user approved the Sandbox
purchase and the merchant displayed Order paid with a charge reference. The
previous generic verifier required an ISO currency code, while the demo emits
only `$5.83`; guessed receipt selectors also missed its `dl` fields. Both browser
adapters now recognize the demo store's visible receipt with exact HTTPS host,
`/shop` path, TEST MODE marker, paid heading, `ch_` reference and matching USD
amount. This USD-only demo exception never interprets a bare dollar sign on
other merchants. Generic merchant receipt requirements remain unchanged.

The real legacy-host fixture fulfills the demo document locally and verifies
recognition plus rejection of a wrong total, AUD currency and token-only
reference. Unit checks also reject another host, HTTP, another path and an
unpaid status. The actual user's paid page was subsequently inspected read-only
with the same parser: its USD 5.83 paid receipt was recognized, without calling
checkout, mutating the page or creating another payment. Bounded evidence is in
`/tmp/omagent-agentcard-paid-receipt-readonly.json`. The original running SDK
controller had already recorded outcome_unknown; this read-only check does not
claim that controller's in-memory status was changed.

Production auto-approval was researched at
https://docs.agentcard.com/vault/app-auto-approval.md. It is not enabled by these
changes, and no Production credentials are selected. The documented app
permission is revocable, has no spending limit or expiry, and requires the app
to obtain purchase approval itself. Sandbox cannot grant that permission.

## Durable daily handover

The final daily record is [22 November handover](../handoffs/2026-11-22.md).
Credential-free copies of the real Sandbox enrollment and paid-receipt read-only
evidence are retained in `evidence/agentcard-2026-11-22/`, so they survive temporary
directory cleanup. These receipts record observations; they do not contain a
live approval link or assert that the original SDK controller was rewritten.

## Existing card auto approval setup

Settings offers Enable auto-approval for a linked Vault. The signed-in person
requests `intent: auto_approval`; the server creates a fresh open session with that
person's stable `external_user_id` and `approval_mode: partner`. It omits
`user_id`, so an existing passkey-only Vault does not require a contact address
for connected-session code delivery. Session polling checks the returned
`user_id` against the existing mapping before accepting it. It omits `steps: ["card"]`, so the hosted flow can
select an existing card instead of requiring a new one. The private link is
shown unchanged in settings. No permission is granted by clicking the Omagent
button; the person completes Agentcard's hosted consent flow.

Session polling retains the link after sign-in until
`payment_permission.ready` is true. Card permission status is read from the
provider's card list. A 403 during partner setup gives a bounded Production /
eligibility error and leaves the saved card intact. An unrelated pending
setup link is never silently reused for permission setup.

The UI states the grant's lack of a spending limit/end date, revocation and
Omagent's continuing purchase-approval requirement. This change does not alter
checkout approval enforcement or silently opt a user into unattended spending.

Verification: 37 focused service/UI/HTTP tests passed, followed by the extended
real-host HTTP fixture (2 tests), which exercises the existing-user permission
session, linked-but-not-ready polling, readiness, unchanged cards and identity,
and private status. All API calls use a loopback stand-in; granting a real
Production permission remains a user action on Agentcard's page.

The full application and server builds, lint, locale and privacy checks passed.
The isolated native setup/390px fixture passed at
`/tmp/omagent-integrations-dU2CvD`. Omagent Dev was reloaded after the change and
its server passed the health check; no real permission link or grant was
created by the automated verification.

The first existing-card permission implementation used a connected `user_id`
session. Agentcard documents `422 contact_missing` when that account has no
contact for code delivery. The passkey-based open session with the same stable
external identity supports existing accounts without collecting contact data.
The isolated provider now rejects connected requests with contact_missing and
verifies the open permission flow completes under the same identity. Unknown
session errors report the HTTP status without raw provider messages or secrets.
