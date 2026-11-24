import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omagent.ts";
import { TelegramBridge } from "./telegram.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { approvalModeFor } from "../shared/approval-mode.ts";

it("relays a paired Telegram message through the actual isolated runtime and sends back its confirmed reply", async () => {
  const fixture = await launchVerificationServer();
  const dir = mkdtempSync(join(tmpdir(), "omagent-telegram-e2e-"));
  const input: object[] = [], output: string[] = [], evidence: object[] = [];
  const request = async (path: string, body?: object, signal?: AbortSignal, method?: "PATCH") => {
    const response = await fetch(`${fixture.info.url}${path}`, { method: method ?? (body ? "POST" : "GET"),
      headers: { "content-type": "application/json", origin: fixture.info.url }, ...(body ? { body: JSON.stringify(body) } : {}), signal });
    const data = await response.json() as Record<string, any>;
    evidence.push({ path, status: response.status, data });
    if (!response.ok) throw Object.assign(new Error("Fixture request failed"), { status: response.status });
    return data;
  };
  const { bot } = await request("/api/bots", { name: "Telegram fixture" });
  let changeAfterSnapshot = false;
  const bridge = new TelegramBridge({ file: join(dir, "telegram.json"), available: () => true,
    approvalMode: async (botId, threadId) => {
      const { bots } = await request("/api/bots");
      const task = bots.find((entry: any) => entry.id === botId)?.tasks.find((entry: any) => entry.threadId === threadId);
      const mode = task ? approvalModeFor(task) : null;
      if (changeAfterSnapshot) await request(`/api/bots/${botId}/tasks/${threadId}`, { approvalMode: "ask" }, undefined, "PATCH");
      return mode;
    },
    bot: id => id === bot.id ? bot : null, request, pollDelayMs: 20,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const method = String(url).split("/").at(-1);
      const body = JSON.parse(String(init?.body));
      const result = method === "getMe" ? { is_bot: true, username: "fixture_bot" } : method === "getWebhookInfo" ? { url: "" }
        : method === "getUpdates" ? input.splice(0) : (output.push(body.text), { message_id: output.length });
      return Response.json({ ok: true, result });
    }) as typeof fetch,
  });
  try {
    expect(await request("/api/integrations/telegram")).toMatchObject({ configured: false, enabled: false });
    await bridge.configure({ token: "123456789:abcdefghijklmnopqrstuvwxyzABCDEF", botId: bot.id, enabled: true });
    const pairing = bridge.pair();
    const message = (update_id: number, text: string) => input.push({ update_id, message: { text, from: { id: 42 }, chat: { id: 42, type: "private" } } });
    message(1, `/start ${new URL(pairing.url).searchParams.get("start")}`);
    await expect.poll(() => bridge.status().paired).toBe(true);
    message(2, "Say hello from the isolated Telegram test");
    await expect.poll(() => output.length, { timeout: 20_000 }).toBeGreaterThan(1);
    expect(output[1]).not.toContain("without a confirmed text reply");
    expect(output[1]).not.toContain("could not start");
    expect(bridge.status().pending).toBe(false);
    const bots = await request("/api/bots");
    const saved = bots.bots.find((entry: any) => entry.id === bot.id);
    const thread = saved.tasks.find((entry: any) => entry.title === "Telegram");
    expect(thread).toBeDefined();
    const page = await request(`/api/threads/${thread.threadId}/messages?limit=30`);
    expect(page.messages.some((entry: any) => entry.role === "user" && entry.relayed && entry.text.includes("isolated Telegram"))).toBe(true);
    expect(page.messages.some((entry: any) => entry.role === "bot" && entry.turnSucceeded)).toBe(true);
    await request(`/api/bots/${bot.id}/tasks/${thread.threadId}`, { approvalMode: "full" }, undefined, "PATCH");
    message(3, "Hello again after selecting Full access");
    await expect.poll(() => output.length, { timeout: 20_000 }).toBe(3);
    expect(output[2]).not.toContain("could not start");
    expect(evidence).toContainEqual(expect.objectContaining({
      path: `/api/bots/${bot.id}/messages/guarded`, status: 202,
    }));
    const fullPage = await request(`/api/threads/${thread.threadId}/messages?limit=30`);
    expect(fullPage.messages.some((entry: any) => entry.role === "user" && entry.relayed && entry.text.includes("after selecting Full access"))).toBe(true);
    changeAfterSnapshot = true;
    message(4, "Do not run after permissions change");
    await expect.poll(() => output.length, { timeout: 20_000 }).toBe(4);
    expect(output[3]).toContain("could not start");
    const rejected = await request(`/api/threads/${thread.threadId}/messages?limit=30`);
    expect(rejected.messages.some((entry: any) => entry.role === "user" && entry.text.includes("Do not run after permissions change"))).toBe(false);
    console.info(`Telegram fixture evidence: ${fixture.info.logPath}.telegram.json`);
  } finally {
    await bridge.stop();
    writeFileSync(`${fixture.info.logPath}.telegram.json`, JSON.stringify({ evidence, output, limitation: "Fake Telegram API and engine; real Omagent guarded routes and persistence. No real messages or account connections." }, null, 2));
    await fixture.close(); await removeTempDir(dir);
  }
}, 40_000);
