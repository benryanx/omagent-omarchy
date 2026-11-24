// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TelegramStatus } from "../../shared/telegram";

const fixture = vi.hoisted(() => ({ status: {} as TelegramStatus, api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: { bots: [{ id: "bot-1", name: "Pip" }] } }) }));
vi.mock("./McpServersPanel", async () => {
  const { createElement } = await import("react");
  return { McpServersPanel: ({ hostedCards }: { hostedCards: { shown(id: string): boolean } }) =>
    createElement("div", { "data-agentcard-only": hostedCards.shown("agentcard") && !hostedCards.shown("whop") }, "AgentCard sign-in") };
});
const { IntegrationsSettings } = await import("./IntegrationsSettings");
let root: Root, host: HTMLDivElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const click = async (text: string) => {
  const button = Array.from(host.querySelectorAll("button")).find(node => node.textContent === text)!;
  expect(button).toBeDefined(); await act(async () => button.click());
};

beforeEach(() => {
  fixture.status = { available: true, configured: false, enabled: false, paired: false, pending: false, botId: null, username: null, error: null };
  fixture.api.mockReset();
  fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/pair")) return { url: "https://t.me/fixture_bot?start=private-code", expiresAt: Date.now() + 600_000 };
    if (init?.method === "PUT") fixture.status = { ...fixture.status, configured: true, enabled: true, username: "fixture_bot", botId: "bot-1" };
    return fixture.status;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("connects from the password field, clears the token and exposes a private pairing link", async () => {
  await act(async () => root.render(createElement(IntegrationsSettings)));
  const token = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(token.autocomplete).toBe("off");
  expect(Array.from(host.querySelectorAll("button")).find(node => node.textContent === "Connect Telegram")?.disabled).toBe(true);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(token, "123456:fixture-token");
    token.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Connect Telegram");
  const saved = fixture.api.mock.calls.find(([, init]) => init?.method === "PUT");
  expect(JSON.parse(saved![1].body)).toEqual({ botId: "bot-1", token: "123456:fixture-token", enabled: true });
  expect(token.value).toBe("");
  await click("Create pairing link");
  expect(host.querySelector('a[href="https://t.me/fixture_bot?start=private-code"]')).not.toBeNull();
  expect(host.textContent).toContain("10 minutes");
});

it("surfaces the personal AgentCard connector and separates its developer setup", async () => {
  await act(async () => root.render(createElement(IntegrationsSettings)));
  expect(host.querySelector('[data-agentcard-only="true"]')).not.toBeNull();
  expect(host.querySelector('a[href="https://docs.agentcard.com/getting-started"]')).not.toBeNull();
  expect(host.querySelector('a[href="https://docs.agentcard.com/commerce-mcp"]')).not.toBeNull();
  expect(host.textContent).toContain("Personal Agentcard shopping tools");
  expect(host.textContent).toContain("Vault checkout setup above");
});

it("does not offer token setup where the personal bridge is unavailable", async () => {
  fixture.status.available = false;
  await act(async () => root.render(createElement(IntegrationsSettings)));
  expect(host.querySelector('section[aria-labelledby="telegram-settings-title"] input[type="password"]')).toBeNull();
  expect(host.textContent).toContain("personal workspaces");
});
