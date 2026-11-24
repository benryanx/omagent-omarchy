// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentcardStatus } from "../../shared/agentcard";

const fixture = vi.hoisted(() => ({ api: vi.fn(), status: {} as AgentcardStatus }));
vi.mock("@/state/store", () => ({ api: fixture.api }));
const { AgentcardVaultSettings, AgentcardApprovalBanner } = await import("./AgentcardVault");
let root: Root, host: HTMLDivElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  fixture.status = { configured: true, linked: false, cards: [], enrollment: null, checkouts: [] };
  fixture.api.mockReset(); fixture.api.mockImplementation(async (_path, init) => {
    if (init?.method === "PUT") fixture.status = { ...fixture.status, configured: true, credentialSource: "saved" };
    if (init?.method === "POST") fixture.status = { ...fixture.status, enrollment: { url: "https://vault.agentcard.sh/v?vs=exact-private-link", expiresAt: Date.now() + 1800_000 } };
    return fixture.status;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("creates the Vault link only after a user clicks, preserves it exactly and never asks for card details", async () => {
  await act(async () => root.render(createElement(AgentcardVaultSettings)));
  expect(fixture.api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  const connect = Array.from(host.querySelectorAll("button")).find(node => node.textContent?.includes("Connect my Vault"))!;
  await act(async () => connect.click());
  expect(fixture.api).toHaveBeenCalledWith("/api/integrations/agentcard/enroll", { method: "POST", body: JSON.stringify({ intent: "connect" }) });
  const link = host.querySelector<HTMLAnchorElement>('a[href*="exact-private-link"]')!;
  expect(link.getAttribute("href")).toBe("https://vault.agentcard.sh/v?vs=exact-private-link");
  expect(link.rel).toBe("noreferrer"); expect(link.target).toBe("_blank");
  expect(host.querySelector("input")).toBeNull();
});

it("shows a private approval above the app with the merchant and exact total", async () => {
  fixture.status.checkouts = [{ id: "fixture", merchant: "shop.example.com", amount: 2306, currency: "usd", status: "awaiting_approval", approvalUrl: "https://vault.agentcard.sh/approve/private" }];
  await act(async () => root.render(createElement(AgentcardApprovalBanner)));
  expect(host.textContent).toContain("shop.example.com · USD 23.06");
  expect(host.querySelector('a[href="https://vault.agentcard.sh/approve/private"]')).not.toBeNull();
  expect(host.textContent).toContain("passkey");
});

it("saves copied credentials privately and reveals the real Vault enrollment flow", async () => {
  fixture.status.configured = false;
  await act(async () => root.render(createElement(AgentcardVaultSettings)));
  const input = host.querySelector<HTMLInputElement>('input[type="text"]')!;
  const password = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(password.autocomplete).toBe("new-password");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => "AGENTCARD_CLIENT_ID=fixture-client-id\nAGENTCARD_CLIENT_SECRET=fixture-private-secret" } });
  await act(async () => input.dispatchEvent(event));
  expect(input.value).toBe("fixture-client-id"); expect(password.value).toBe("fixture-private-secret");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const save = fixture.api.mock.calls.find(([path]) => path.endsWith("/credentials"))!;
  expect(save[1].method).toBe("PUT"); expect(JSON.parse(save[1].body)).toEqual({ clientId: "fixture-client-id", clientSecret: "fixture-private-secret" });
  expect(host.querySelector("input")).toBeNull(); expect(host.textContent).not.toContain("fixture-private-secret");
  const connect = Array.from(host.querySelectorAll("button")).find(node => node.textContent?.includes("Connect my Vault"))!;
  await act(async () => connect.click());
  expect(host.querySelector('a[href="https://vault.agentcard.sh/v?vs=exact-private-link"]')).not.toBeNull();
});

it("keeps environment-managed credentials and member accounts out of the edit form", async () => {
  fixture.status = { ...fixture.status, configured: false, canConfigure: false };
  await act(async () => root.render(createElement(AgentcardVaultSettings)));
  expect(host.querySelector("input")).toBeNull();
});

it("shows unfinished setup when an account is linked without a stored card", async () => {
  fixture.status.linked = true;
  await act(async () => root.render(createElement(AgentcardVaultSettings)));
  expect(host.textContent).toContain("no stored card was found");
  const finish = Array.from(host.querySelectorAll("button")).find(node => node.textContent === "Finish Vault setup")!;
  await act(async () => finish.click());
  expect(fixture.api).toHaveBeenCalledWith("/api/integrations/agentcard/enroll", { method: "POST", body: JSON.stringify({ intent: "connect" }) });
});

it("requests another card explicitly only when a stored card is already present", async () => {
  fixture.status.linked = true;
  fixture.status.cards = [{ id: "vc_fixture", brand: "visa", last4: "4242", expiryMonth: 12, expiryYear: 2040 }];
  await act(async () => root.render(createElement(AgentcardVaultSettings)));
  const add = Array.from(host.querySelectorAll("button")).find(node => node.textContent === "Add another card")!;
  await act(async () => add.click());
  expect(fixture.api).toHaveBeenCalledWith("/api/integrations/agentcard/enroll", { method: "POST", body: JSON.stringify({ intent: "add" }) });
});

it("offers a separate permission flow for the saved card with the grant's terms", async () => {
  fixture.status = { ...fixture.status, linked: true, cards: [{ id: "vc_fixture", brand: "visa", last4: "3545", expiryMonth: 3, expiryYear: 2028 }] };
  await act(async () => root.render(createElement(AgentcardVaultSettings)));
  expect(host.textContent).toContain("no spending limit or expiry");
  const enable = Array.from(host.querySelectorAll("button")).find(node => node.textContent === "Enable auto-approval")!;
  await act(async () => enable.click());
  expect(fixture.api).toHaveBeenCalledWith("/api/integrations/agentcard/enroll", { method: "POST", body: JSON.stringify({ intent: "auto_approval" }) });
  expect(host.textContent).toContain("3545");
});
