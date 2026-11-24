import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachToCdp, VaultClient, type AttachOptions, type CheckoutController, type CheckoutState, type MerchantResult } from "@agent-cards/sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentcardVault, type CheckoutPage } from "./agentcard.ts";
import { confirmedAgentcardDemoReceipt, confirmedMerchantOrder, confirmedMerchantReceipt } from "./browser/agentcard.ts";
import { stripWorkspaceCredentialEnv } from "./credential-env.ts";
import { scrubHeldSecrets } from "../shared/redact.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { AgentcardCredentialsStore } from "./agentcard-credentials.ts";

let dir: string, file: string, service: AgentcardVault, now: number;
let external: string, options: AttachOptions, state: CheckoutState, merchant: MerchantResult;
const fetcher = vi.fn<typeof fetch>();
const sync = vi.fn(async () => {});
const env = { AGENTCARD_CLIENT_ID: "fixture-client", AGENTCARD_CLIENT_SECRET: "fixture-private-secret" };
const cards = { data: [{ id: "vc_fixture", brand: "visa", last4: "4242", expiry_month: 12, expiry_year: 2040 }] };
const close = vi.fn(async () => {});
const page: CheckoutPage = { tab: "t2", sessionId: "session-fixture", cdp: { send: async () => ({}), on: () => {} },
  close, navigate: async () => {}, merchantResult: async () => merchant };
let attach: ReturnType<typeof vi.fn<typeof attachToCdp>>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omagent-agentcard-")); file = join(dir, "agentcard-vault.json"); now = Date.now(); external = "";
  merchant = { status: "unknown" }; state = { status: "idle", authorizationId: null };
  fetcher.mockReset(); sync.mockClear(); close.mockClear();
  fetcher.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/oauth/token")) return Response.json({ access_token: "fixture-access-token", expires_in: 3600 });
    if (url.endsWith("/vault_sessions") && init?.method === "POST") {
      external = JSON.parse(String(init.body)).external_user_id;
      return Response.json({ id: "vs_fixture", url: "https://vault.agentcard.sh/v?vs=private-fixture", expires_at: new Date(now + 1800_000).toISOString(), poll_interval: 3 });
    }
    if (url.includes("/vault_cards?")) return Response.json(cards);
    return Response.json({ status: "linked", user_id: "usr_fixture", external_user_id: external, poll_interval: 3 });
  });
  attach = vi.fn(async (_cdp, _session, opts) => {
    options = opts;
    const controller: CheckoutController = {
      getState: () => state,
      cancel: () => { state = { ...state, status: state.authorizationId ? "outcome_unknown" : "cancelled" }; options.onStateChange?.(state); },
      reconcile: async () => {
        const result = await opts.resolveMerchantResult!(state);
        state = result.status === "completed" ? { status: "completed", authorizationId: "cauth_fixture", orderId: result.orderId } : { status: "outcome_unknown", authorizationId: "cauth_fixture" };
        opts.onStateChange?.(state); return state;
      },
      prepare: async () => { throw new Error("Not used"); }, requestUserAction: async () => {}, retryAfterMerchantFailure: () => {},
    };
    return controller;
  });
});
afterEach(async () => { await service?.close(); await removeTempDir(dir); });

function create(linked = false, credentialsEnv: NodeJS.ProcessEnv = env) {
  if (linked) writeFileSync(file, JSON.stringify({ alice: "usr_alice", bob: "usr_bob" }));
  const vault = new VaultClient({ clientId: "fixture", clientSecret: "fixture" });
  vi.spyOn(vault, "syncRegistry").mockImplementation(sync);
  service = new AgentcardVault({ file, env: credentialsEnv, vault, fetch: fetcher, attach, now: () => now });
  return service;
}
const prepare = { action: "prepare", url: "https://shop.example.com/cart", amount: 2306, currency: "usd" };
const active = () => {};

it("links only the signed-in person, reuses enrollment, honors polling and stores no private links", async () => {
  create();
  await Promise.all([service.enroll("alice"), service.enroll("alice")]);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/vault_sessions"))).toHaveLength(1);
  expect((await service.status("alice")).enrollment?.url).toBe("https://vault.agentcard.sh/v?vs=private-fixture");
  expect((await service.status("bob")).enrollment).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/vs_"))).toHaveLength(0);
  now += 3000;
  const linked = await service.status("alice");
  expect(linked.linked).toBe(true); expect(linked.cards[0].last4).toBe("4242"); expect(linked.enrollment).toBeNull();
  expect(Object.values(JSON.parse(readFileSync(file, "utf8")))).toEqual(["usr_fixture"]);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readFileSync(file, "utf8")).not.toMatch(/private|https|token/);
  expect((await service.status("bob")).linked).toBe(false);
  expect(scrubHeldSecrets("fixture-private-secret https://vault.agentcard.sh/v?vs=private-fixture")).toBe("•••••• ••••••");
});

it("rejects a session that links to another app identity", async () => {
  create(); await service.enroll("alice"); external = "another-person"; now += 3000;
  await expect(service.status("alice")).rejects.toThrow("identity did not match");
});

it("checks stored cards before enrollment and sends no new link for a returning user", async () => {
  create(true);
  await service.enroll("alice");
  expect(fetcher.mock.calls.some(([url]) => String(url).includes("/vault_cards?user_id=usr_alice"))).toBe(true);
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/vault_sessions"))).toBe(false);
  expect((await service.status("alice")).enrollment).toBeNull();
});

it("uses an open session to finish an empty Vault and adds another card with the same external identity", async () => {
  create(true);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, init) => String(url).includes("/vault_cards?") ? Promise.resolve(Response.json({ data: [] })) : original(url, init));
  await service.enroll("alice");
  const first = JSON.parse(String(fetcher.mock.calls.find(([url]) => String(url).endsWith("/vault_sessions"))![1]!.body));
  expect(first.user_id).toBeUndefined(); expect(first.steps).toBeUndefined();
  now += 1800_001;
  await service.enroll("alice", "add");
  const sessions = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/vault_sessions"));
  expect(sessions).toHaveLength(2);
  const second = JSON.parse(String(sessions[1][1]!.body));
  expect(second.external_user_id).toBe(first.external_user_id);
  expect(second.user_id).toBeUndefined(); expect(second.steps).toEqual(["card"]);
});

it("treats a missing company connection as enrollment, without reusing an inaccessible user id", async () => {
  create(true);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, init) => String(url).includes("/vault_cards?") ? Promise.resolve(Response.json({ error: { code: "connection_not_found" } }, { status: 404 })) : original(url, init));
  await service.enroll("alice");
  const body = JSON.parse(String(fetcher.mock.calls.find(([url]) => String(url).endsWith("/vault_sessions"))![1]!.body));
  expect(body.user_id).toBeUndefined();
  expect((await service.status("alice")).linked).toBe(false);
  expect(Object.values(JSON.parse(readFileSync(file, "utf8")))).not.toContain("usr_alice");
});

it.each([401, 403, 500])("does not send another enrollment link when the card lookup fails with %s", async status => {
  create(true);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, init) => String(url).includes("/vault_cards?") ? Promise.resolve(Response.json({ error: "unavailable" }, { status })) : original(url, init));
  await expect(service.enroll("alice")).rejects.toThrow(status === 401 ? "saved project credentials" : "could not read your Vault");
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/vault_sessions"))).toBe(false);
});

it("rechecks current cards instead of trusting a cached card before sending a new link", async () => {
  create(true); expect((await service.status("alice")).cards).toHaveLength(1);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, init) => String(url).includes("/vault_cards?") ? Promise.resolve(Response.json({ data: [] })) : original(url, init));
  await service.enroll("alice");
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/vault_sessions"))).toBe(true);
});

it("attaches before navigation, creates one client, hides approval links and enforces person and conversation bindings", async () => {
  create(true);
  const events: string[] = [];
  const open = async () => { events.push("open"); return { ...page, navigate: async () => {
    events.push("navigate"); expect(attach).toHaveBeenCalledTimes(1);
    state = { status: "awaiting_approval", authorizationId: "cauth_fixture" }; options.onStateChange?.(state);
    options.onApprovalUrl?.("https://vault.agentcard.sh/approve/private-fixture");
  } }; };
  const result = await service.tool("alice", "bot:thread", prepare, open, active) as { id: string };
  expect(events).toEqual(["open", "navigate"]);
  expect(options.user).toBe("usr_alice"); expect(options.serviceWorkers).toBe("bypass"); expect(options.requireMerchantResult).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/private-fixture|https:\/\/vault|usr_alice/);
  expect((await service.status("alice")).checkouts[0].approvalUrl).toContain("private-fixture");
  expect((await service.status("bob")).checkouts).toEqual([]);
  await expect(service.tool("bob", "bot:thread", { action: "status", id: result.id }, open, active)).rejects.toThrow("not found");
  await expect(service.tool("alice", "other-thread", { action: "status", id: result.id }, open, active)).rejects.toThrow("not found");
  await service.tool("bob", "other:thread", prepare, async () => page, active);
  expect(sync).toHaveBeenCalledTimes(1);
});

it("checks the requesting person's project Vault without browser access or personal connector results", async () => {
  create(true);
  await service.enroll("alice", "add");
  const open = vi.fn(async () => page);
  const result = await service.tool("alice", "thread", { action: "cards" }, open, active);
  expect(result).toMatchObject({ configured: true, linked: true, cards: [{ brand: "visa", last4: "4242" }] });
  expect(JSON.stringify(result)).not.toMatch(/usr_alice|vc_fixture|private-fixture|https:\/\/vault/);
  expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled();
  expect(await service.tool("charlie", "thread", { action: "cards" }, open, active)).toMatchObject({ linked: false, cards: [] });
});

it("identifies a browser setup failure while preserving the fact that the Vault card was found", async () => {
  create(true);
  const failure = await service.tool("alice", "thread", prepare, async () => { throw new Error("Sensitive transport detail ws://127.0.0.1/private"); }, active).catch(error => error);
  expect(failure.message).toContain("browser connection");
  expect(failure.message).toContain("saved Omagent Vault card was found");
  expect(failure.message).not.toContain("ws://");
});

it("keeps an idle shopping page usable after premature reconciliation and permits a fresh checkout only after SDK cancellation", async () => {
  create(true);
  const result = await service.tool("alice", "bot:thread", prepare, async () => page, active) as { id: string };
  const read = await service.tool("alice", "bot:thread", { action: "reconcile", id: result.id }, async () => page, active);
  expect(read).toMatchObject({ status: "idle", merchantConfirmed: false });
  await expect(service.tool("alice", "bot:thread", prepare, async () => page, active)).rejects.toThrow(result.id);
  expect(await service.tool("alice", "bot:thread", { action: "cancel", id: result.id }, async () => page, active)).toMatchObject({ status: "cancelled" });
  state = { status: "idle", authorizationId: null };
  expect(await service.tool("alice", "bot:thread", prepare, async () => page, active)).toMatchObject({ status: "idle" });
});

it("cannot clear an authorized unknown outcome by cancelling", async () => {
  create(true);
  const result = await service.tool("alice", "bot:thread", prepare, async () => page, active) as { id: string };
  state = { status: "awaiting_merchant", authorizationId: "cauth_fixture" };
  expect(await service.tool("alice", "bot:thread", { action: "cancel", id: result.id }, async () => page, active)).toMatchObject({ status: "outcome_unknown" });
  await expect(service.tool("alice", "bot:thread", prepare, async () => page, active)).rejects.toThrow("already has a checkout");
});

it("requires a merchant-confirmed order after approval and refuses automatic repeat purchases on unknown outcomes", async () => {
  create(true);
  const result = await service.tool("alice", "bot:thread", prepare, async () => page, active) as { id: string };
  state = { status: "awaiting_merchant", authorizationId: "cauth_fixture" };
  const unresolved = await service.tool("alice", "bot:thread", { action: "reconcile", id: result.id }, async () => page, active);
  expect(unresolved).toMatchObject({ status: "outcome_unknown", merchantConfirmed: false });
  await expect(service.tool("alice", "bot:thread", prepare, async () => page, active)).rejects.toThrow("already has a checkout");
  merchant = { status: "completed", orderId: "ORDER-123" };
  expect(await service.tool("alice", "bot:thread", { action: "reconcile", id: result.id }, async () => page, active))
    .toMatchObject({ status: "completed", merchantConfirmed: true, orderId: "ORDER-123" });
});

it("refuses checkout without a stored card or with model-supplied identity and closes an interrupted setup", async () => {
  create(true);
  const open = vi.fn(async () => page);
  await expect(service.tool("alice", "thread", { ...prepare, user: "usr_bob" }, open, active)).rejects.toThrow("Use prepare");
  await expect(service.tool("alice", "thread", { ...prepare, url: "http://shop.example.com" }, open, active)).rejects.toThrow("Use prepare");
  await expect(service.tool("charlie", "thread", prepare, open, active)).rejects.toThrow("Add a card");
  const assertActive = vi.fn(() => { if (open.mock.calls.length) throw new Error("Turn ended"); });
  await expect(service.tool("alice", "thread", prepare, open, assertActive)).rejects.toThrow("setup did not finish");
  expect(close).toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled();
});

it("does not forward Agentcard credentials to provider subprocesses", () => {
  const child = { ...env, PATH: "/fixture/bin" }; stripWorkspaceCredentialEnv(child);
  expect(child).toEqual({ PATH: "/fixture/bin" });
});

it("verifies and encrypts credentials, restores them on restart and never returns their values", async () => {
  service = new AgentcardVault({ file, env: {}, fetch: fetcher, now: () => now });
  expect(service.configured()).toBe(false);
  const credentials = { clientId: "fixture-client-id", clientSecret: "fixture-private-secret" };
  await service.configure(credentials);
  expect(await service.status("alice")).toMatchObject({ configured: true, credentialSource: "saved", linked: false });
  expect(new AgentcardCredentialsStore(dir).get()).toEqual(credentials);
  for (const name of ["agentcard-credentials.json.enc", "agentcard-credentials-key"]) {
    expect(readFileSync(join(dir, name), "utf8")).not.toContain(credentials.clientSecret);
    expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600);
  }
  expect(JSON.stringify(await service.status("alice"))).not.toContain(credentials.clientId);
  expect(scrubHeldSecrets(credentials.clientSecret)).toBe("••••••");
  await service.close();
  service = new AgentcardVault({ file, env: {}, fetch: fetcher });
  expect(service.configured()).toBe(true); expect(service.credentialSource()).toBe("saved");
});

it("keeps the previous encrypted credentials when verification fails and never leaks a provider's error", async () => {
  create(false, {});
  const first = { clientId: "fixture-client-one", clientSecret: "fixture-private-secret-one" };
  await service.configure(first);
  fetcher.mockResolvedValueOnce(Response.json({ error: "fixture-private-secret-two is invalid" }, { status: 401 }));
  await expect(service.configure({ clientId: "fixture-client-two", clientSecret: "fixture-private-secret-two" })).rejects.toThrow("did not accept these credentials");
  expect(new AgentcardCredentialsStore(dir).get()).toEqual(first);
});

it("keeps Sandbox and Production user mappings separate when switching credentials", async () => {
  create(false, {});
  const sandbox = { clientId: "fixture-sandbox-client", clientSecret: "fixture-private-sandbox-secret" };
  const production = { clientId: "fixture-production-client", clientSecret: "fixture-private-production-secret" };
  await service.configure(sandbox); await service.enroll("alice"); now += 3000;
  expect((await service.status("alice")).linked).toBe(true);
  await service.configure(production); expect((await service.status("alice")).linked).toBe(false);
  await service.configure(sandbox); expect((await service.status("alice")).linked).toBe(true);
  await service.tool("alice", "thread", prepare, async () => page, active);
  await expect(service.configure(production)).rejects.toThrow("current checkout");
});

it("does not override credentials managed by the operator's environment", async () => {
  create();
  await expect(service.configure({ clientId: "fixture-client-two", clientSecret: "fixture-private-secret-two" })).rejects.toThrow("server environment");
});

it("accepts merchant receipt evidence only for an exact total, currency and completed order", () => {
  const order = { "@type": "Order", orderNumber: "123", orderStatus: "https://schema.org/OrderProcessing", price: "23.06", priceCurrency: "USD" };
  expect(confirmedMerchantOrder([order], 2306, "usd")).toEqual({ status: "completed", orderId: "123" });
  expect(confirmedMerchantOrder([{ ...order, price: "24.06" }], 2306, "usd")).toEqual({ status: "unknown" });
  expect(confirmedMerchantOrder([{ ...order, orderStatus: "OrderPaymentDue" }], 2306, "usd")).toEqual({ status: "unknown" });
  expect(confirmedMerchantReceipt({ order: "123", status: "Order confirmed", total: "USD 23.06" }, 2306, "usd")).toEqual({ status: "completed", orderId: "123" });
  expect(confirmedMerchantReceipt({ order: "123", status: "Order not confirmed", total: "USD 23.06" }, 2306, "usd")).toEqual({ status: "unknown" });
  expect(confirmedMerchantReceipt({ order: "123", status: "Order confirmed", total: "AUD 23.06" }, 2306, "usd")).toEqual({ status: "unknown" });
});

it("recognizes only the USD demo store's visible paid receipt with a charge reference and matching total", () => {
  const receipt = { order: "ch_fixturePaid", status: "Order paid ✓", total: "$5.83", testMode: true };
  expect(confirmedAgentcardDemoReceipt("https://shop.agentcard.sh/shop", receipt, 583, "usd")).toEqual({ status: "completed", orderId: "ch_fixturePaid" });
  for (const [url, changed, amount, currency] of [
    ["https://other.example/shop", receipt, 583, "usd"],
    ["http://shop.agentcard.sh/shop", receipt, 583, "usd"],
    ["https://shop.agentcard.sh/other", receipt, 583, "usd"],
    ["https://shop.agentcard.sh/shop", receipt, 583, "aud"],
    ["https://shop.agentcard.sh/shop", receipt, 584, "usd"],
    ["https://shop.agentcard.sh/shop", { ...receipt, testMode: false }, 583, "usd"],
    ["https://shop.agentcard.sh/shop", { ...receipt, order: "tok_fixtureOnly" }, 583, "usd"],
    ["https://shop.agentcard.sh/shop", { ...receipt, status: "Payment pending" }, 583, "usd"],
  ] as const) expect(confirmedAgentcardDemoReceipt(url, changed, amount, currency)).toEqual({ status: "unknown" });
});

it("requests a separate permission link for the existing account and waits beyond sign-in for readiness", async () => {
  create(true);
  let ready = false;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) => {
    if (String(url).includes("/vault_sessions/vs_")) return Response.json({ status: "linked", user_id: "usr_alice", external_user_id: external, payment_permission: { ready } });
    return original(url, init);
  });
  await service.enroll("alice", "auto_approval");
  const posted = JSON.parse(String(fetcher.mock.calls.find(([url, init]) => String(url).endsWith("/vault_sessions") && init?.method === "POST")![1]!.body));
  expect(posted).toMatchObject({ approval_mode: "partner" });
  expect(posted.user_id).toBeUndefined();
  expect(posted.steps).toBeUndefined();
  now += 3100;
  expect((await service.status("alice")).enrollment).toMatchObject({ intent: "auto_approval" });
  ready = true; now += 3100;
  expect((await service.status("alice")).enrollment).toBeNull();
  expect(Object.values(JSON.parse(readFileSync(file, "utf8")))).toContain("usr_alice");
});

it("keeps the saved card on a refused auto-approval session and does not silently reuse an ordinary link", async () => {
  create(true);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) => String(url).endsWith("/vault_sessions") && init?.method === "POST"
    ? Response.json({ error: { code: "partner_enrollment_disabled" } }, { status: 403 }) : original(url, init));
  await expect(service.enroll("alice", "auto_approval")).rejects.toThrow("Production credentials");
  expect((await service.status("alice")).cards[0].last4).toBe("4242");
  fetcher.mockImplementation(original);
  await service.enroll("alice", "add");
  await expect(service.enroll("alice", "auto_approval")).rejects.toThrow("existing secure Vault setup");
});

it("does not require a contact for existing-card permission and preserves the identity check", async () => {
  create(true);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/vault_sessions") && init?.method === "POST" && JSON.parse(String(init.body)).user_id) return Response.json({ error: { code: "contact_missing", message: "private provider text" } }, { status: 422 });
    if (String(url).includes("/vault_sessions/vs_")) return Response.json({ status: "linked", external_user_id: external, user_id: "usr_someone_else", payment_permission: { ready: true } });
    return original(url, init);
  });
  await service.enroll("alice", "auto_approval");
  now += 3100;
  await expect(service.status("alice")).rejects.toThrow("different account");
});

it("reports session creation refusals without exposing raw provider details", async () => {
  create(true);
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) => String(url).endsWith("/vault_sessions") && init?.method === "POST"
    ? Response.json({ error: { message: "sensitive-provider-value" } }, { status: 400 }) : original(url, init));
  const error = await service.enroll("alice", "auto_approval").catch(error => error);
  expect(error.message).toContain("setup link (HTTP 400)");
  expect(error.message).not.toContain("sensitive-provider-value");
});
