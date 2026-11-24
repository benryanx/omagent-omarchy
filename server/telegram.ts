import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { Agent, fetch as telegramFetch } from "undici";
import { writeFileAtomic } from "./atomic.ts";
import type { TelegramPairing, TelegramStatus } from "../shared/telegram.ts";
import type { ApprovalMode } from "../shared/approval-mode.ts";

// Node 24 in Electron can abandon a working IPv4 connection after 250ms before trying unreachable IPv6.
const telegramDispatcher = new Agent({ connect: { autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 1000 } });

const pendingSchema = z.object({
  sendId: z.string(), text: z.string(), expectedActiveLeafId: z.string().nullable(),
  expectedApprovalMode: z.enum(["ask", "full"]).default("ask"),
  accepted: z.boolean(), waitingNotified: z.boolean(),
  submitted: z.boolean().default(false), cancelRequested: z.boolean().default(false),
  delivery: z.array(z.string()).optional(), delivered: z.number().int().nonnegative().default(0),
});
const stateSchema = z.object({
  token: z.string().optional(), username: z.string().optional(), botId: z.string().optional(),
  enabled: z.boolean().default(false), offset: z.number().int().nonnegative().default(0),
  userId: z.number().int().positive().optional(), chatId: z.number().int().positive().optional(),
  threadId: z.string().optional(), pending: pendingSchema.optional(),
});
type State = z.infer<typeof stateSchema>;
type Pending = z.infer<typeof pendingSchema>;
type Json = Record<string, any>;

export interface TelegramDeps {
  file: string;
  available(): boolean;
  bot(id: string): { id: string; name: string; hidden?: boolean } | null | undefined;
  approvalMode(botId: string, threadId: string): ApprovalMode | null | Promise<ApprovalMode | null>;
  request(path: string, body?: object, signal?: AbortSignal, method?: "PATCH"): Promise<Json>;
  fetch?: typeof fetch;
  now?: () => number;
  pollDelayMs?: number;
}

export class TelegramError extends Error {
  status: number;
  haltReceiver: boolean;
  constructor(message: string, status = 400, haltReceiver = false) { super(message); this.status = status; this.haltReceiver = haltReceiver; }
}

/** Telegram limits sendMessage text to 4096 characters after entity parsing; plain text needs no escaping. */
export function telegramChunks(text: string): string[] {
  const points = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < points.length; i += 2000) chunks.push(points.slice(i, i + 2000).join(""));
  return chunks.length ? chunks : ["The request finished without a text reply. Open Omagent to review it."];
}

const pause = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) return resolve();
  const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
  const timer = setTimeout(done, ms);
  signal.addEventListener("abort", done, { once: true });
});

export class TelegramBridge {
  private deps: TelegramDeps;
  private state: State = stateSchema.parse({});
  private error: string | null = null;
  private controller?: AbortController;
  private running?: Promise<void>;
  private pairing?: { code: string; expiresAt: number };
  private changing = false;

  constructor(deps: TelegramDeps) {
    this.deps = deps;
    try { this.state = stateSchema.parse(JSON.parse(readFileSync(deps.file, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.error = "Telegram settings could not be read. Reconnect to replace them.";
    }
  }

  status(): TelegramStatus {
    return { available: this.deps.available(), configured: Boolean(this.state.token), enabled: this.state.enabled,
      botId: this.state.botId ?? null, username: this.state.username ?? null,
      paired: Boolean(this.state.userId && this.state.chatId), pending: Boolean(this.state.pending), error: this.error };
  }

  /** Owner authority applies only to the exact pending text received from the paired private account; names and request IDs alone prove nothing. */
  ownsRequest(botId: string, body: Readonly<Record<string, unknown>>): boolean {
    const pending = this.state.pending;
    return Boolean(this.deps.available() && this.state.enabled && this.state.userId && this.state.chatId === this.state.userId
      && this.state.botId === botId && pending?.submitted && !pending.cancelRequested
      && body.threadId === this.state.threadId && body.sendId === pending.sendId && body.text === pending.text
      && body.expectedActiveLeafId === pending.expectedActiveLeafId && body.expectedApprovalMode === pending.expectedApprovalMode
      && body.replyToId === undefined && body.reaction === undefined);
  }

  private save() { writeFileAtomic(this.deps.file, JSON.stringify(this.state), { mode: 0o600 }); }

  private async call(token: string, method: string, body: object, signal?: AbortSignal): Promise<any> {
    try {
      const init: RequestInit = {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(15_000),
      };
      const url = `https://api.telegram.org/bot${token}/${method}`;
      const response = this.deps.fetch ? await this.deps.fetch(url, init)
        : await telegramFetch(url, { ...init, dispatcher: telegramDispatcher } as Parameters<typeof telegramFetch>[1]);
      const data = await response.json() as Json;
      if (!response.ok || data.ok !== true) {
        if (response.status === 401) throw new TelegramError("Telegram rejected the token. Reconnect with the current BotFather token.", 400, true);
        if (response.status === 409) throw new TelegramError("Another Telegram receiver is running. Stop it before enabling this connection.", 409, true);
        throw new TelegramError("Telegram could not complete the request. Check the connection and try again.");
      }
      return data.result;
    } catch (error) {
      if (error instanceof TelegramError) throw error;
      throw new TelegramError("Telegram could not be reached. Check your network connection.");
    }
  }

  async configure(input: { token?: string; botId: string; enabled: boolean }): Promise<TelegramStatus> {
    if (!this.deps.available()) throw new TelegramError("Telegram is available on personal workspaces with owner access.", 403);
    if (this.changing) throw new TelegramError("Telegram settings are already being updated.", 409);
    if (!this.deps.bot(input.botId) || this.deps.bot(input.botId)?.hidden) throw new TelegramError("Choose an existing bot.");
    if (this.state.pending) throw new TelegramError("Finish or stop the Telegram request before changing its connection.", 409);
    const token = input.token?.trim() || this.state.token;
    if (!token || !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new TelegramError("Enter the bot token from BotFather.");
    this.changing = true;
    try {
      const me = await this.call(token, "getMe", {});
      if (me.is_bot !== true || typeof me.username !== "string" || !/^[A-Za-z0-9_]+$/.test(me.username)) throw new TelegramError("This token does not identify a Telegram bot.");
      const webhook = await this.call(token, "getWebhookInfo", {});
      if (webhook.url) throw new TelegramError("This Telegram bot already uses a webhook. Remove that connection in its current app first.");
      await this.stop();
      if (this.state.pending) { this.start(); throw new TelegramError("Finish or stop the Telegram request before changing its connection.", 409); }
      const same = token === this.state.token;
      this.state = { ...(same ? this.state : stateSchema.parse({})), token, username: me.username, botId: input.botId,
        enabled: input.enabled, ...(this.state.botId !== input.botId ? { threadId: undefined } : {}) };
      this.pairing = undefined;
      this.error = null;
      this.save(); this.start();
      return this.status();
    } finally { this.changing = false; }
  }

  pair(): TelegramPairing {
    if (!this.state.enabled || !this.state.token || !this.state.username) throw new TelegramError("Connect and enable Telegram first.");
    if (this.state.userId) throw new TelegramError("Disconnect before pairing a different Telegram account.", 409);
    const expiresAt = (this.deps.now?.() ?? Date.now()) + 10 * 60_000;
    const code = randomBytes(24).toString("base64url");
    this.pairing = { code, expiresAt };
    return { url: `https://t.me/${this.state.username}?start=${code}`, expiresAt };
  }

  async disconnect(): Promise<void> {
    if (this.changing) throw new TelegramError("Telegram settings are already being updated.", 409);
    if (this.state.pending) throw new TelegramError("Finish or stop the Telegram request before disconnecting.", 409);
    this.changing = true;
    try {
      await this.stop();
      if (this.state.pending) { this.start(); throw new TelegramError("Finish or stop the Telegram request before disconnecting.", 409); }
      this.state = stateSchema.parse({}); this.pairing = undefined; this.error = null; this.save();
    } finally { this.changing = false; }
  }

  async cancel(): Promise<TelegramStatus> {
    if (this.changing) throw new TelegramError("Telegram settings are already being updated.", 409);
    this.changing = true;
    try {
      await this.stop();
      await this.interrupt(new AbortController().signal, false);
      return this.status();
    } finally { this.changing = false; this.start(); }
  }

  start(): void {
    if (this.running || !this.deps.available() || !this.state.enabled || !this.state.token) return;
    const controller = new AbortController(); this.controller = controller;
    this.running = this.run(controller.signal).finally(() => { this.running = undefined; });
  }

  async stop(): Promise<void> { this.controller?.abort(); await this.running; this.controller = undefined; }

  private async send(text: string, signal: AbortSignal): Promise<void> {
    for (const chunk of telegramChunks(text)) {
      await this.call(this.state.token!, "sendMessage", { chat_id: this.state.chatId, text: chunk, link_preview_options: { is_disabled: true } }, signal);
    }
  }

  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let delay = this.deps.pollDelayMs ?? 1000;
      try {
        const updates = await this.call(this.state.token!, "getUpdates", {
          offset: this.state.offset, timeout: this.state.pending ? 1 : 20, limit: 20, allowed_updates: ["message"],
        }, signal);
        if (signal.aborted) break;
        if (!Array.isArray(updates)) throw new TelegramError("Telegram returned an invalid update list.");
        for (const update of updates) {
          if (signal.aborted) break;
          if (!Number.isSafeInteger(update.update_id) || update.update_id < this.state.offset) continue;
          // Persist before acting: replaying a Telegram update must never repeat a bot action after a restart.
          this.state.offset = update.update_id + 1; this.save();
          await this.receive(update.message, update.update_id, signal);
        }
        if (!signal.aborted && this.state.pending) await this.follow(signal);
      } catch (error) {
        if (signal.aborted) break;
        delay = Math.max(delay, 5000);
        this.error = error instanceof TelegramError ? error.message : "Telegram could not process the request. Open Omagent to review it.";
        if (error instanceof TelegramError && error.haltReceiver) { this.state.enabled = false; this.save(); return; }
      }
      await pause(delay, signal);
    }
  }

  private async receive(message: Json | undefined, updateId: number, signal: AbortSignal): Promise<void> {
    if (!message || message.chat?.type !== "private" || !Number.isSafeInteger(message.from?.id) || message.from.id <= 0
      || message.from.is_bot || message.chat.id !== message.from.id || typeof message.text !== "string") return;
    const text = message.text.trim();
    if (!this.state.userId) {
      const code = text.startsWith("/start ") ? text.slice(7) : "";
      const pairing = this.pairing;
      if (!pairing || pairing.expiresAt <= (this.deps.now?.() ?? Date.now()) || Buffer.byteLength(code) !== Buffer.byteLength(pairing.code)
        || !timingSafeEqual(Buffer.from(code), Buffer.from(pairing.code))) return;
      this.state.userId = message.from.id; this.state.chatId = message.chat.id; this.pairing = undefined; this.save();
      await this.send("Connected to Omagent. Send a message to chat with your selected bot. Use /status, /stop or /help. Approvals stay in Omagent.", signal);
      return;
    }
    if (this.state.userId !== message.from.id || this.state.chatId !== message.chat.id) return;
    if (text === "/start" || text === "/help") {
      await this.send("Send text to your selected Omagent bot. /status checks its request; /stop stops the request you sent here. Review approvals and questions in Omagent. Omagent must stay running to receive messages.", signal); return;
    }
    if (text === "/status") { await this.send(this.state.pending ? "Your Telegram request is still active. Open Omagent for details or approvals." : "Connected. No Telegram request is running.", signal); return; }
    if (text === "/stop") { await this.interrupt(signal); return; }
    if (text.startsWith("/")) { await this.send("Unknown command. Use /help for available commands.", signal); return; }
    if (!text) return;
    if (text.length > 20_000) { await this.send("Please send a shorter message.", signal); return; }
    if (this.state.pending) { await this.send("Your earlier Telegram request is still active. Use /stop or wait for its reply.", signal); return; }
    const bot = this.state.botId && this.deps.bot(this.state.botId);
    if (!bot || bot.hidden) { await this.send("The selected bot is no longer available. Choose a bot in Omagent’s Telegram settings.", signal); return; }
    if (!this.state.threadId) {
      const created = await this.deps.request(`/api/bots/${bot.id}/tasks`, { title: "Telegram" }, signal);
      if (typeof created.task?.threadId !== "string") throw new TelegramError("Could not create the Telegram conversation.");
      this.state.threadId = created.task.threadId; this.save();
      await this.deps.request(`/api/bots/${bot.id}/tasks/${this.state.threadId}`, { approvalMode: "ask" }, signal, "PATCH");
    }
    const threadId = this.state.threadId;
    if (!threadId) throw new TelegramError("Could not read the Telegram conversation.");
    const page = await this.deps.request(`/api/threads/${threadId}/messages?limit=1`, undefined, signal);
    if (page.activeLeafId !== null && typeof page.activeLeafId !== "string") throw new TelegramError("Could not read the Telegram conversation.");
    const expectedApprovalMode = await this.deps.approvalMode(bot.id, threadId);
    if (expectedApprovalMode !== "ask" && expectedApprovalMode !== "full") {
      await this.send("Choose Ask or Full access for the Telegram conversation in Omagent, then send your message again.", signal); return;
    }
    const sendId = `telegram-${createHash("sha256").update(`${this.state.username}:${this.state.userId}:${updateId}`).digest("hex")}`;
    this.state.pending = { sendId, text, expectedActiveLeafId: page.activeLeafId, expectedApprovalMode,
      accepted: false, waitingNotified: false, submitted: false, cancelRequested: false, delivered: 0 };
    this.save();
  }

  private requestPath() { return `/api/bots/${this.state.botId}/requests/${this.state.pending!.sendId}`; }

  private async follow(signal: AbortSignal): Promise<void> {
    const pending = this.state.pending!;
    if (pending.cancelRequested) { await this.interrupt(signal); return; }
    if (!pending.accepted) {
      try {
        pending.submitted = true; this.save();
        await this.deps.request(`/api/bots/${this.state.botId}/messages/guarded`, {
          threadId: this.state.threadId, sendId: pending.sendId, text: pending.text, expectedActiveLeafId: pending.expectedActiveLeafId,
          expectedApprovalMode: pending.expectedApprovalMode,
          onBehalfOf: { name: "Telegram owner" },
        }, signal);
        pending.accepted = true; this.save();
      } catch (error) {
        if ([400, 403, 404, 409, 413].includes((error as { status: number }).status)) {
          delete this.state.pending; this.save();
          await this.send("Omagent could not start this request. Its conversation may be busy, changed or awaiting approval. Review it in Omagent, then send your message again.", signal); return;
        }
        throw error;
      }
    }
    if (!pending.delivery) {
      let snapshot: Json;
      try { snapshot = await this.deps.request(`${this.requestPath()}?threadId=${this.state.threadId}`, undefined, signal); }
      catch (error) {
        if ([404, 409, 413].includes((error as { status: number }).status)) {
          delete this.state.pending; this.save();
          await this.send("This request can no longer be followed safely. Open Omagent to review its conversation.", signal); return;
        }
        throw error;
      }
      if (snapshot.phase === "waiting" && !pending.waitingNotified) {
        pending.waitingNotified = true; this.save();
        await this.send("Your bot needs attention. Open the Telegram conversation in Omagent to review its approval or question.", signal);
      }
      if (snapshot.phase === "working" || snapshot.phase === "waiting") return;
      const final = snapshot.phase === "settled" && Array.isArray(snapshot.messages)
        ? snapshot.messages.findLast((m: Json) => m.role === "bot" && m.kind === "text" && m.turnSucceeded === true) : undefined;
      pending.delivery = telegramChunks(final?.text ?? "The request ended without a confirmed text reply. Open Omagent to review it.");
      this.save();
    }
    await this.deliver(pending, signal);
  }

  private async deliver(pending: Pending, signal: AbortSignal): Promise<void> {
    while (pending.delivered < pending.delivery!.length) {
      const text = pending.delivery![pending.delivered]!;
      // Mark before sending: a lost Telegram receipt must not duplicate a delivered reply on restart.
      pending.delivered++; this.save();
      await this.send(text, signal);
    }
    delete this.state.pending; this.error = null; this.save();
  }

  private async interrupt(signal: AbortSignal, notify = true): Promise<void> {
    if (!this.state.pending) { if (notify) await this.send("No Telegram request is running.", signal); return; }
    this.state.pending.cancelRequested = true; this.save();
    if (!this.state.pending.submitted) { delete this.state.pending; this.save(); if (notify) await this.send("The pending Telegram request was cancelled before it started.", signal); return; }
    let snapshot: Json;
    try { snapshot = await this.deps.request(`${this.requestPath()}?threadId=${this.state.threadId}`, undefined, signal); }
    catch (error) {
      if ([404, 409, 413].includes((error as { status: number }).status)) { await this.unconfirmedStop(signal, notify); return; }
      throw error;
    }
    if (snapshot.phase === "untracked") { await this.unconfirmedStop(signal, notify); return; }
    if (snapshot.phase === "settled") {
      if (notify) { this.state.pending.cancelRequested = false; this.save(); await this.follow(signal); }
      else { delete this.state.pending; this.save(); }
      return;
    }
    try {
      await this.deps.request(`${this.requestPath()}/interrupt`, {
        threadId: this.state.threadId, messageId: snapshot.messageId, expectedActiveLeafId: snapshot.activeLeafId,
        expectedTurnId: snapshot.activeTurnId, expectedExecutionId: snapshot.executionId,
      }, signal);
    } catch (error) {
      if ([404, 409, 413].includes((error as { status: number }).status)) { await this.unconfirmedStop(signal, notify); return; }
      throw error;
    }
    delete this.state.pending; this.save();
    if (notify) await this.send("Your Telegram request was stopped. Work already completed remains in Omagent.", signal);
  }

  private async unconfirmedStop(signal: AbortSignal, notify: boolean): Promise<void> {
    delete this.state.pending;
    this.error = "Could not confirm that this request stopped. Telegram is no longer following it. Open Omagent to review and stop any remaining work.";
    this.save();
    if (notify) await this.send(this.error, signal);
  }
}
