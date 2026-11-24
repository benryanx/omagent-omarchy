import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramBridge, telegramChunks } from "./telegram.ts";
import { requiredScope } from "./request-auth.ts";
import type { ApprovalMode } from "../shared/approval-mode.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const token = "123456789:abcdefghijklmnopqrstuvwxyzABCDEF";
const active: Array<{ bridge: TelegramBridge; dir: string }> = [];
afterEach(async () => { for (const item of active.splice(0)) { await item.bridge.stop(); await removeTempDir(item.dir); } });

function fixture() {
  let now = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "omagent-telegram-"));
  const incoming: any[] = [], sent: string[] = [];
  const request = vi.fn(async (path: string, body?: object): Promise<Record<string, any>> => {
    if (path.endsWith("/tasks")) return { task: { threadId: "telegram-thread" } };
    if (path.includes("/messages?")) return { activeLeafId: null };
    if (path.includes("/requests/")) return { phase: "settled", messages: [{ role: "bot", kind: "text", text: "A verified reply", turnSucceeded: true }] };
    return { ok: true, body };
  });
  const api = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(url).split("/").at(-1);
    const body = JSON.parse(String(init?.body));
    if (method === "getMe") return Response.json({ ok: true, result: { is_bot: true, username: "fixture_bot" } });
    if (method === "getWebhookInfo") return Response.json({ ok: true, result: { url: "" } });
    if (method === "getUpdates") return Response.json({ ok: true, result: incoming.splice(0) });
    if (method === "sendMessage") { sent.push(body.text); return Response.json({ ok: true, result: { message_id: sent.length } }); }
    throw new Error("Unexpected Telegram method");
  });
  const deps = { file: join(dir, "telegram.json"), available: () => true, bot: (id: string) => id === "bot" ? { id, name: "Fixture" } : null,
    approvalMode: vi.fn<() => ApprovalMode | null>(() => "ask"),
    request, fetch: api as typeof fetch, pollDelayMs: 5, now: () => now };
  const bridge = new TelegramBridge(deps); active.push({ bridge, dir });
  let update = 0;
  const message = (text: string, user = 42, type = "private") => incoming.push({ update_id: ++update, message: { text, from: { id: user }, chat: { id: user, type } } });
  const connect = async () => bridge.configure({ token, botId: "bot", enabled: true });
  const pair = async () => { const link = bridge.pair(); message(`/start ${new URL(link.url).searchParams.get("start")}`); await vi.waitFor(() => expect(bridge.status().paired).toBe(true)); };
  return { bridge, deps, request, api, incoming, sent, message, connect, pair, advance: (ms: number) => { now += ms; } };
}

describe("Telegram personal bridge", () => {
  it("honors Full access selected for the Telegram conversation", async () => {
    const f = fixture(); await f.connect(); await f.pair();
    f.deps.approvalMode.mockReturnValue("full");
    f.message("Hello with the selected permissions");
    await vi.waitFor(() => expect(f.sent).toContain("A verified reply"));
    expect(f.request.mock.calls.find(([path]) => path.endsWith("/messages/guarded"))?.[1])
      .toMatchObject({ expectedApprovalMode: "full" });
  });

  it("recognizes only the exact paired owner's pending request, not a claimed name or altered message", async () => {
    const f = fixture(); await f.connect(); await f.pair();
    const original = f.request.getMockImplementation()!;
    let verified = false;
    f.request.mockImplementation(async (path, body) => {
      if (path.endsWith("/messages/guarded")) {
        const request = body as Record<string, unknown>;
        expect(f.bridge.ownsRequest("bot", request)).toBe(true);
        for (const altered of [
          { ...request, text: "Buy something else" }, { ...request, threadId: "other-thread" },
          { ...request, sendId: "other-send" }, { ...request, expectedApprovalMode: "full" },
          { ...request, expectedActiveLeafId: "another-leaf" }, { ...request, replyToId: "another-message" },
        ]) expect(f.bridge.ownsRequest("bot", altered)).toBe(false);
        expect(f.bridge.ownsRequest("other-bot", request)).toBe(false);
        verified = true;
      }
      return original(path, body);
    });
    expect(f.bridge.ownsRequest("bot", { onBehalfOf: { name: "Telegram owner" } })).toBe(false);
    f.message("Buy only the fixture cable");
    await vi.waitFor(() => expect(f.sent).toContain("A verified reply"));
    expect(verified).toBe(true);
    const request = f.request.mock.calls.find(([path]) => path.endsWith("/messages/guarded"))![1] as Record<string, unknown>;
    expect(f.bridge.ownsRequest("bot", request)).toBe(false);
  });

  it("keeps the original permission snapshot when retrying an uncertain send", async () => {
    const f = fixture(); await f.connect(); await f.pair();
    const original = f.request.getMockImplementation()!;
    let attempts = 0;
    f.request.mockImplementation(async (path, body) => {
      if (path.endsWith("/messages/guarded") && attempts++ === 0) {
        f.deps.approvalMode.mockReturnValue("full");
        throw Object.assign(new Error("temporarily unavailable"), { status: 503 });
      }
      return original(path, body);
    });
    f.message("Keep my permission snapshot");
    await vi.waitFor(() => expect(f.sent).toContain("A verified reply"), { timeout: 7000 });
    const sends = f.request.mock.calls.filter(([path]) => path.endsWith("/messages/guarded"));
    expect(sends).toHaveLength(2);
    expect(sends.map(([, body]) => (body as { expectedApprovalMode: string }).expectedApprovalMode)).toEqual(["ask", "ask"]);
  });

  it("explains unsupported permission modes without sending or changing them", async () => {
    const f = fixture(); await f.connect(); await f.pair();
    f.deps.approvalMode.mockReturnValue("custom");
    f.message("Hello");
    await vi.waitFor(() => expect(f.sent.some(text => text.includes("Choose Ask or Full access"))).toBe(true));
    expect(f.request.mock.calls.filter(([path]) => path.endsWith("/messages/guarded"))).toHaveLength(0);
    expect(f.bridge.status().pending).toBe(false);
  });

  it("requires owner/admin access for every setup route", () => {
    for (const method of ["GET", "PUT", "DELETE"]) expect(requiredScope(method, "/api/integrations/telegram")).toBe("admin");
    expect(requiredScope("POST", "/api/integrations/telegram/pair")).toBe("admin");
    expect(requiredScope("POST", "/api/integrations/telegram/stop")).toBe("admin");
  });

  it("pairs only a private account with the one-time link, keeps its token private and persists the binding", async () => {
    const f = fixture(); await f.connect();
    f.message("hello"); f.message("/start wrong");
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(f.bridge.status().paired).toBe(false); expect(f.sent).toEqual([]);
    await f.pair();
    f.message("someone else", 43); f.message("group text", 42, "group");
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(f.request).not.toHaveBeenCalled();
    expect(JSON.stringify(f.bridge.status())).not.toContain(token);
    if (process.platform !== "win32") expect(statSync(f.deps.file).mode & 0o777).toBe(0o600);
    await f.bridge.stop();
    const restored = new TelegramBridge(f.deps);
    expect(restored.status()).toMatchObject({ configured: true, paired: true, botId: "bot" });
    expect(JSON.parse(readFileSync(f.deps.file, "utf8")).userId).toBe(42);
  });

  it("sends through guarded requests and never repeats an update", async () => {
    const f = fixture(); await f.connect(); await f.pair();
    f.message("Hello from Telegram");
    const replay = structuredClone(f.incoming[0]);
    await vi.waitFor(() => expect(f.sent).toContain("A verified reply"));
    const sends = f.request.mock.calls.filter(([path]) => path.endsWith("/messages/guarded"));
    expect(sends).toHaveLength(1);
    expect(sends[0][1]).toMatchObject({ threadId: "telegram-thread", text: "Hello from Telegram", expectedActiveLeafId: null });
    f.incoming.push(replay);
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(f.request.mock.calls.filter(([path]) => path.endsWith("/messages/guarded"))).toHaveLength(1);
    expect(f.sent.filter(text => text === "A verified reply")).toHaveLength(1);
  });

  it("rejects expired pairing links", async () => {
    const f = fixture(); await f.connect();
    const link = f.bridge.pair(); f.advance(600_001);
    f.message(`/start ${new URL(link.url).searchParams.get("start")}`);
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(f.bridge.status().paired).toBe(false);
    expect(f.sent).toEqual([]);
  });

  it("does not take over an existing webhook or expose token-bearing failures", async () => {
    const f = fixture();
    f.api.mockImplementation(async (url) => {
      if (String(url).endsWith("getMe")) return Response.json({ ok: true, result: { is_bot: true, username: "fixture_bot" } });
      return Response.json({ ok: true, result: { url: "https://example.invalid/webhook" } });
    });
    await expect(f.connect()).rejects.toThrow("already uses a webhook");
    expect(f.bridge.status().configured).toBe(false);
    f.api.mockRejectedValue(new Error(`https://api.telegram.org/bot${token}/getMe`));
    await expect(f.connect()).rejects.toThrow("could not be reached");
    expect(JSON.stringify(f.bridge.status())).not.toContain(token);
  });

  it("reports approvals once and stops only the owned request with exact execution guards", async () => {
    const f = fixture();
    const snapshot = { phase: "waiting", messageId: "user-1", activeLeafId: "card-1", activeTurnId: "turn-1", executionId: "exec-1", messages: [] };
    f.request.mockImplementation(async path => path.includes("/requests/") && !path.endsWith("/interrupt") ? snapshot
      : path.endsWith("/tasks") ? { task: { threadId: "telegram-thread" } }
      : path.includes("/messages?") ? { activeLeafId: null } : { ok: true });
    await f.connect(); await f.pair(); f.message("Needs permission");
    await vi.waitFor(() => expect(f.sent.some(text => text.includes("needs attention"))).toBe(true));
    f.message("/stop");
    await vi.waitFor(() => expect(f.sent.some(text => text.includes("was stopped"))).toBe(true));
    const stop = f.request.mock.calls.find(([path]) => path.endsWith("/interrupt"));
    expect(stop?.[1]).toEqual({ threadId: "telegram-thread", messageId: "user-1", expectedActiveLeafId: "card-1", expectedTurnId: "turn-1", expectedExecutionId: "exec-1" });
    expect(f.sent.filter(text => text.includes("needs attention"))).toHaveLength(1);
    expect(f.bridge.status().pending).toBe(false);
  });

  it("lets the workspace stop its request even when Telegram is offline", async () => {
    const f = fixture();
    const snapshot = { phase: "working", messageId: "user-1", activeLeafId: "user-1", activeTurnId: "turn-1", executionId: "exec-1", messages: [] };
    f.request.mockImplementation(async path => path.includes("/requests/") && !path.endsWith("/interrupt") ? snapshot
      : path.endsWith("/tasks") ? { task: { threadId: "telegram-thread" } }
      : path.includes("/messages?") ? { activeLeafId: null } : { ok: true });
    await f.connect(); await f.pair(); f.message("A slow task");
    await vi.waitFor(() => expect(f.request.mock.calls.some(([path]) => path.includes("/requests/"))).toBe(true));
    f.api.mockRejectedValue(new Error("offline"));
    expect((await f.bridge.cancel()).pending).toBe(false);
    expect(f.request.mock.calls.some(([path]) => path.endsWith("/interrupt"))).toBe(true);
  });

  it("never interrupts an untracked execution or reports it as stopped", async () => {
    const f = fixture();
    let phase = "working";
    f.request.mockImplementation(async path => path.includes("/requests/") ? { phase, messages: [] }
      : path.endsWith("/tasks") ? { task: { threadId: "telegram-thread" } }
      : path.includes("/messages?") ? { activeLeafId: null } : { ok: true });
    await f.connect(); await f.pair(); f.message("A changing request");
    await vi.waitFor(() => expect(f.request.mock.calls.some(([path]) => path.includes("/requests/"))).toBe(true));
    phase = "untracked";
    const status = await f.bridge.cancel();
    expect(status.pending).toBe(false);
    expect(status.error).toContain("Could not confirm");
    expect(f.request.mock.calls.some(([path]) => path.endsWith("/interrupt"))).toBe(false);
    await f.bridge.disconnect();
    expect(f.bridge.status().configured).toBe(false);
  });

  it("splits long Unicode replies without splitting surrogate pairs", () => {
    const value = "🎄".repeat(5000);
    const chunks = telegramChunks(value);
    expect(chunks.join("")).toBe(value);
    expect(chunks.every(chunk => chunk.length <= 4096)).toBe(true);
  });
});
