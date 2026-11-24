import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { VaultClient, attachToCdp, attachToPlaywright, type CheckoutController, type CheckoutState, type CdpLike, type MerchantResult } from "@agent-cards/sdk";
import type { Page } from "playwright-core";
import { z } from "zod";
import { addHeldSecretScrubber } from "../shared/redact.ts";
import type { AgentcardStatus } from "../shared/agentcard.ts";
import { AgentcardCredentialsStore, agentcardCredentialsSchema, type AgentcardCredentials } from "./agentcard-credentials.ts";

export class AgentcardError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}

export interface CheckoutPage {
  tab: string;
  cdp: CdpLike;
  sessionId: string;
  playwright?: Page;
  browse?(input: CheckoutBrowserInput): Promise<object>;
  navigate(url: string): Promise<void>;
  merchantResult(merchant: string, amount: number, currency: string, receipt?: MerchantReceiptSelectors): Promise<MerchantResult>;
  close(): Promise<void>;
}

export interface MerchantReceiptSelectors { order: string; status: string; total: string }
export interface CheckoutBrowserInput { operation: "read" | "navigate" | "click" | "fill" | "press"; selector?: string; frame?: string; text?: string; url?: string }

const prepareSchema = z.object({
  action: z.literal("prepare"),
  url: z.url().max(8192).refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port; }),
  amount: z.number().int().positive().max(100_000_000).describe("For prepare: integer minor units, e.g. 583 for USD 5.83. Never pass a decimal major-unit amount."),
  currency: z.string().regex(/^[a-zA-Z]{3}$/),
}).strict();
const checkoutSchema = z.discriminatedUnion("action", [prepareSchema,
  z.object({ action: z.literal("cards") }).strict(),
  z.object({ action: z.enum(["status", "cancel"]), id: z.uuid() }).strict(),
  z.object({ action: z.literal("reconcile"), id: z.uuid(), receipt: z.object({
    order: z.string().min(1).max(500), status: z.string().min(1).max(500), total: z.string().min(1).max(500),
  }).strict().optional().describe("CSS selectors for the merchant's visible receipt: order reference, confirmed/placed/paid status, and total including its ISO currency code. Only read the current receipt; never initiate another payment. Needed when the merchant publishes no structured Order record.") }).strict(),
  z.object({ action: z.literal("browse"), id: z.uuid(), operation: z.enum(["read", "navigate", "click", "fill", "press"]),
    selector: z.string().min(1).max(1000).optional(), text: z.string().max(4000).optional(), url: z.url().max(8192).optional(),
    frame: z.string().min(1).max(1000).optional().describe("CSS selector of the payment iframe containing selector; omit for the main page."),
  }).strict(),
]);

export const AGENTCARD_TOOL = {
  name: "agent_browser_checkout",
  description: "Check saved cards and pay using the requesting person's Omagent project Vault. This is separate from the personal Agentcard MCP connector; that connector's list_cards is NOT this Vault. Use action cards to check this Vault's saved cards without making a purchase. Call prepare BEFORE visiting a payment form with url, integer amount in minor units (583 for USD 5.83), and currency: it opens a fresh isolated checkout tab, arms interception, then navigates. Use only the returned placeholder card in that tab; never ask for real card details. Approval links go privately to the person's Omagent UI, never to you. Keep using the returned tab. If browserControl is checkout, use this tool's browse action with this id (read, navigate, click, fill, press with Playwright selectors) for all checkout interactions; ordinary browser tools address a different context. Call reconcile after submission; report success ONLY when status is completed and merchantConfirmed is true. Unknown outcomes must be checked with the merchant before any retry. status checks do not make a purchase. cancel does not reverse a charge. Enrollment is in Settings > Messaging & payments.",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["action"],
    properties: { ...Object.assign({}, ...checkoutSchema.options.map(option => z.toJSONSchema(option).properties)),
      action: { type: "string", enum: ["cards", "prepare", "status", "browse", "reconcile", "cancel"] } },
  },
};

interface Enrollment { intent: "connect" | "add" | "auto_approval"; id: string; url: string; expiresAt: number; nextPoll: number; interval: number }
interface Purchase {
  id: string; person: string; scope: string; merchant: string; amount: number; currency: string;
  approvalUrl: string | null; createdAt: number; page?: CheckoutPage; controller?: CheckoutController;
  state: Readonly<CheckoutState>; merchantConfirmed: boolean; receipt?: MerchantReceiptSelectors;
}
interface Options {
  file: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  vault?: VaultClient;
  attach?: typeof attachToCdp;
  now?: () => number;
}

export class AgentcardVault {
  readonly #options: Options;
  readonly #env: NodeJS.ProcessEnv;
  readonly #credentialStore: AgentcardCredentialsStore;
  #credentials: AgentcardCredentials | null;
  #changing = false;
  #revision = 0;
  readonly #fetch: typeof fetch;
  readonly #people = new Map<string, string>();
  readonly #enrollments = new Map<string, Enrollment>();
  readonly #enrolling = new Map<string, Promise<void>>();
  readonly #cards = new Map<string, { readAt: number; cards: AgentcardStatus["cards"] }>();
  readonly #purchases = new Map<string, Purchase>();
  readonly #secrets = new Set<string>();
  readonly #unscrub: () => void;
  #vault: Promise<VaultClient> | null = null;
  #token: { value: string; expiresAt: number } | null = null;
  #tokenPending: Promise<string> | null = null;

  constructor(options: Options) {
    this.#options = options; this.#env = options.env ?? process.env; this.#fetch = options.fetch ?? fetch;
    this.#credentialStore = new AgentcardCredentialsStore(dirname(options.file));
    this.#credentials = this.#env.AGENTCARD_CLIENT_ID && this.#env.AGENTCARD_CLIENT_SECRET
      ? { clientId: this.#env.AGENTCARD_CLIENT_ID, clientSecret: this.#env.AGENTCARD_CLIENT_SECRET } : this.#credentialStore.get();
    if (this.#credentials) for (const secret of Object.values(this.#credentials)) this.#secrets.add(secret);
    this.#unscrub = addHeldSecretScrubber(text => {
      let result = text;
      for (const secret of this.#secrets) result = result.split(secret).join("••••••");
      return result;
    });
    if (existsSync(options.file)) {
      const saved = z.record(z.string(), z.string().regex(/^usr_[\w-]+$/)).parse(JSON.parse(readFileSync(options.file, "utf8")));
      for (const [person, user] of Object.entries(saved)) this.#people.set(person.startsWith("acp_") ? person : this.#personKey(person), user);
    }
  }

  configured(): boolean { return Boolean(this.#options.vault || this.#credentials); }
  credentialSource(): "environment" | "saved" | null {
    return this.#env.AGENTCARD_CLIENT_ID && this.#env.AGENTCARD_CLIENT_SECRET ? "environment" : this.#credentials ? "saved" : null;
  }
  #personKey(person: string): string { return `acp_${createHash("sha256").update(`${this.#credentials?.clientId ?? ""}\0${person}`).digest("hex")}`; }
  #user(person: string): string | undefined { return this.#people.get(this.#personKey(person)); }
  #assertStable(): void { if (this.#changing) throw new AgentcardError("Agentcard credentials are being updated. Try again in a moment."); }
  #settled(row: Purchase): boolean { return row.state.status === "completed" ? row.merchantConfirmed : ["declined", "timed_out", "cancelled", "failed", "unsupported"].includes(row.state.status); }
  #now(): number { return this.#options.now?.() ?? Date.now(); }
  #external(person: string): string { return `omagent_${createHash("sha256").update(this.#options.file + "\0" + this.#personKey(person)).digest("hex")}`; }

  async configure(input: unknown): Promise<void> {
    if (this.credentialSource() === "environment") throw new AgentcardError("These credentials are managed by the server environment. Update them there.");
    this.#assertStable();
    if ([...this.#purchases.values()].some(row => !this.#settled(row))) {
      throw new AgentcardError("Finish or reconcile the current checkout before changing Agentcard credentials.");
    }
    const checked = agentcardCredentialsSchema.safeParse(input);
    if (!checked.success) throw new AgentcardError("Enter the Client ID and Client secret values from Agentcard, without the variable names.", 400);
    const credentials = checked.data;
    for (const value of Object.values(credentials)) this.#secrets.add(value);
    this.#changing = true;
    try {
      const token = await this.#authenticate(credentials);
      this.#credentialStore.put(credentials);
      this.#revision++;
      this.#credentials = credentials;
      this.#vault = null; this.#token = token; this.#tokenPending = null;
      this.#enrollments.clear(); this.#cards.clear();
    } catch (error) {
      throw error instanceof AgentcardError ? error : new AgentcardError("Agentcard credentials could not be saved securely. Your previous setup was kept.", 503);
    } finally { this.#changing = false; }
  }

  async #authenticate(credentials: AgentcardCredentials): Promise<{ value: string; expiresAt: number }> {
    const response = await this.#fetch("https://api.agentcard.sh/api/v2/oauth/token", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: credentials.clientId, client_secret: credentials.clientSecret }) });
    if (!response.ok) throw new AgentcardError("Agentcard did not accept these credentials. Check that the Client ID and secret are from the same Sandbox or Production client.", 400);
    const token = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).parse(await response.json());
    this.#secrets.add(token.access_token);
    return { value: token.access_token, expiresAt: this.#now() + Math.max(1, token.expires_in - 30) * 1000 };
  }
  async #client(): Promise<VaultClient> {
    this.#assertStable();
    if (!this.configured()) throw new AgentcardError("Connect your Agentcard project in Settings > Messaging & payments first.", 503);
    this.#vault ??= (async () => {
      const vault = this.#options.vault ?? new VaultClient(this.#credentials!);
      await vault.syncRegistry();
      return vault;
    })().catch(() => { this.#vault = null; throw new AgentcardError("Agentcard could not initialize. Check the server credentials and Vault access.", 503); });
    return this.#vault;
  }

  async #accessToken(): Promise<string> {
    this.#assertStable();
    if (this.#token && this.#token.expiresAt > this.#now()) return this.#token.value;
    this.#tokenPending ??= (async () => {
      if (!this.configured()) throw new AgentcardError("Agentcard server credentials are not configured.", 503);
      const credentials = this.#credentials;
      if (!credentials) throw new AgentcardError("Agentcard server credentials are not configured.", 503);
      const token = await this.#authenticate(credentials);
      if (credentials !== this.#credentials) throw new AgentcardError("Agentcard credentials changed. Please try again.");
      this.#token = token;
      return token.value;
    })().finally(() => { this.#tokenPending = null; });
    return this.#tokenPending;
  }

  async #api(path: string, body?: object, missingUserIsEmpty = false): Promise<unknown> {
    this.#assertStable();
    const revision = this.#revision;
    const token = await this.#accessToken();
    const response = await this.#fetch(`https://api.agentcard.sh/api/v2/${path}`, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (revision !== this.#revision) throw new AgentcardError("Agentcard credentials changed. Please try again.");
    if (response.status === 401) this.#token = null;
    if (response.status === 404 && missingUserIsEmpty) return null;
    if (!response.ok) {
      const failure = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
      const code = failure?.error?.code;
      if (code === "partner_enrollment_disabled") throw new AgentcardError("Agentcard refused auto-approval setup. It requires Production credentials and an app eligible for auto-approval. Your saved card has not changed.", 403);
      if (code === "contact_missing") throw new AgentcardError("Agentcard requires a contact for code-based Vault sign-in. Use a fresh passkey-based setup link instead. Your saved card has not changed.", 422);
      if (response.status === 429) throw new AgentcardError("Agentcard's setup request limit was reached. Wait before creating another Vault link.", 429);
      if (response.status === 401) throw new AgentcardError("Agentcard did not accept the saved project credentials. Check the current Client ID and secret in settings.", 401);
      if (body && path === "vault_sessions") throw new AgentcardError(`Agentcard could not create the secure Vault setup link (HTTP ${response.status}). Your saved card has not changed.`, 502);
      throw new AgentcardError("Agentcard could not read your Vault. Please try again.", 502);
    }
    const value: unknown = await response.json();
    if (revision !== this.#revision) throw new AgentcardError("Agentcard credentials changed. Please try again.");
    return value;
  }

  async enroll(person: string, intent: "connect" | "add" | "auto_approval" = "connect"): Promise<void> {
    const existing = this.#enrolling.get(person);
    if (existing) return existing;
    const work = (async () => {
      const cards = await this.#storedCards(person, true);
      if (intent === "connect" && cards.length > 0) return;
      const pending = this.#enrollments.get(person);
      if (pending && pending.expiresAt > this.#now()) {
        if (pending.intent !== intent) throw new AgentcardError("Finish the existing secure Vault setup link before starting a different setup.");
        return;
      }
      if (intent === "auto_approval" && (!this.#user(person) || !cards.length)) throw new AgentcardError("Connect your Vault and save a card before requesting auto-approval.");
      const session = z.object({ id: z.string().regex(/^vs_[\w-]+$/), url: z.url(), expires_at: z.string(), poll_interval: z.number().positive() }).parse(await this.#api("vault_sessions", {
        external_user_id: this.#external(person), expires_in: 1800,
        ...(intent === "add" ? { steps: ["card"] } : {}),
        ...(intent === "auto_approval" ? { approval_mode: "partner" } : {}),
      }));
      const url = privateAgentcardUrl(session.url);
      const expiresAt = Date.parse(session.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= this.#now()) throw new AgentcardError("Agentcard returned an expired Vault link.", 502);
      this.#secrets.add(url);
      this.#enrollments.set(person, { intent, id: session.id, url, expiresAt, nextPoll: this.#now() + session.poll_interval * 1000, interval: Math.max(3, session.poll_interval) * 1000 });
    })().finally(() => this.#enrolling.delete(person));
    this.#enrolling.set(person, work);
    return work;
  }

  async status(person: string): Promise<AgentcardStatus> {
    const enrollment = this.#enrollments.get(person);
    if (enrollment && enrollment.expiresAt <= this.#now()) this.#enrollments.delete(person);
    else if (enrollment && enrollment.nextPoll <= this.#now()) {
      enrollment.nextPoll = this.#now() + enrollment.interval;
      const result = z.object({ status: z.enum(["pending", "linked", "expired"]), user_id: z.string().regex(/^usr_[\w-]+$/).nullable().optional(), external_user_id: z.string().nullable().optional(), poll_interval: z.number().positive().optional(), payment_permission: z.object({ ready: z.boolean() }).nullable().optional() })
        .parse(await this.#api(`vault_sessions/${enrollment.id}`));
      if (result.poll_interval) enrollment.interval = Math.max(3, result.poll_interval) * 1000;
      enrollment.nextPoll = this.#now() + enrollment.interval;
      if (result.status === "linked" && result.user_id) {
        if (result.external_user_id !== this.#external(person)) throw new AgentcardError("Vault session identity did not match the signed-in person.", 502);
        const previous = this.#user(person);
        if (previous && previous !== result.user_id) throw new AgentcardError("This Vault link belongs to a different account.", 409);
        this.#people.set(this.#personKey(person), result.user_id);
        this.#savePeople();
        if (enrollment.intent !== "auto_approval" || result.payment_permission?.ready === true) this.#enrollments.delete(person);
        this.#cards.delete(person);
      } else if (result.status === "expired") this.#enrollments.delete(person);
    }
    const current = this.#enrollments.get(person);
    const cards = this.#user(person) ? await this.#storedCards(person).catch(() => this.#cards.get(person)?.cards ?? []) : [];
    return { configured: this.configured(), credentialSource: this.credentialSource(), linked: Boolean(this.#user(person)), cards, enrollment: current ? { url: current.url, expiresAt: current.expiresAt, intent: current.intent } : null,
      checkouts: [...this.#purchases.values()].filter(row => row.person === person).map(row => ({ id: row.id, merchant: row.merchant, amount: row.amount, currency: row.currency,
        status: row.state.status === "completed" && !row.merchantConfirmed ? "awaiting_merchant" : row.state.status, approvalUrl: row.approvalUrl,
        ...(row.state.status === "completed" && row.merchantConfirmed && row.state.orderId ? { orderId: row.state.orderId } : {}) })) };
  }

  #savePeople(): void {
    mkdirSync(dirname(this.#options.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.#options.file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.#people)), { mode: 0o600 });
    renameSync(tmp, this.#options.file);
  }

  async #storedCards(person: string, fresh = false): Promise<AgentcardStatus["cards"]> {
    const cached = this.#cards.get(person);
    if (!fresh && cached && this.#now() - cached.readAt < 10_000) return cached.cards;
    const user = this.#user(person);
    if (!user) return [];
    const value = await this.#api(`vault_cards?user_id=${encodeURIComponent(user)}`, undefined, true);
    if (value === null) {
      this.#people.delete(this.#personKey(person));
      this.#cards.delete(person);
      this.#savePeople();
      return [];
    }
    const response = z.object({ data: z.array(z.object({ id: z.string(), brand: z.string(), last4: z.string().regex(/^\d{4}$/),
      expiry_month: z.number().int().min(1).max(12), expiry_year: z.number().int().min(2000).max(9999), payment_permission: z.object({ status: z.enum(["pending", "active", "revoked", "retired", "unavailable"]) }).nullable().optional() })) }).parse(value);
    const cards = response.data.map(card => ({ id: card.id, brand: card.brand, last4: card.last4, expiryMonth: card.expiry_month, expiryYear: card.expiry_year, ...(card.payment_permission ? { autoApproval: card.payment_permission.status } : {}) }));
    this.#cards.set(person, { readAt: this.#now(), cards });
    return cards;
  }

  async tool(person: string, scope: string, input: unknown, open: () => Promise<CheckoutPage>, assertActive: () => void): Promise<object> {
    const checked = checkoutSchema.safeParse(input);
    if (!checked.success) throw new AgentcardError("Use prepare with an HTTPS merchant URL, positive integer amount in minor units and three-letter currency; or status/reconcile/cancel with your checkout id.", 400);
    const args = checked.data;
    if (args.action === "cards") {
      assertActive();
      const status = await this.status(person);
      const cards = this.#user(person) ? await this.#storedCards(person, true) : [];
      assertActive();
      return { configured: status.configured, linked: Boolean(this.#user(person)), cards: cards.map(({ brand, last4, expiryMonth, expiryYear }) => ({ brand, last4, expiryMonth, expiryYear })),
        instruction: cards.length ? "This Omagent Vault has a stored card. Use prepare for browser checkout; the personal MCP list_cards tool addresses a different account."
          : "Finish Vault setup in Omagent Settings > Messaging & payments. Never send card details in chat." };
    }
    if (args.action !== "prepare") {
      const row = this.#purchases.get(args.id);
      if (!row || row.person !== person || row.scope !== scope) throw new AgentcardError("Checkout not found in this conversation.", 404);
      assertActive();
      if (!row.controller) throw new AgentcardError("Checkout setup is still in progress.");
      if (args.action === "browse") {
        if (!row.page?.browse) throw new AgentcardError("Use the ordinary browser tools with the checkout tab returned by prepare.");
        const result = await row.page.browse(args);
        assertActive();
        return { ...this.#safe(row), page: result };
      }
      if (args.action === "reconcile") {
        row.state = row.controller.getState();
        if (row.state.status === "idle") return { ...this.#safe(row), instruction: "This checkout is idle; no payment result is available to reconcile. Continue browsing with this id, or cancel it before preparing another checkout. Cancellation must return cancelled before a retry is allowed." };
        if (args.receipt) row.receipt = args.receipt;
        try { row.state = await row.controller.reconcile(); }
        catch { throw new AgentcardError("The payment outcome is not confirmed. Check the merchant order; do not retry payment."); }
      }
      if (args.action === "cancel") { row.controller.cancel(); row.state = row.controller.getState(); row.approvalUrl = null; await row.page?.close(); }
      assertActive();
      return this.#safe(row);
    }
    if (!this.#user(person)) throw new AgentcardError("Add a card to your Agentcard Vault in Settings > Messaging & payments first. Never send card details in chat.");
    const existing = [...this.#purchases.values()].find(row => row.scope === scope && !this.#settled(row));
    if (existing) {
      throw new AgentcardError(`This conversation already has a checkout (${existing.id}, status ${existing.state.status}). Continue browsing that checkout or cancel it if abandoning it. Only a cancelled checkout permits a fresh attempt; reconcile an unknown merchant result before attempting another purchase.`);
    }
    const row: Purchase = { id: randomUUID(), person, scope, merchant: new URL(args.url).hostname, amount: args.amount, currency: args.currency.toLowerCase(),
      approvalUrl: null, state: { status: "idle", authorizationId: null }, createdAt: this.#now(), merchantConfirmed: false };
    this.#purchases.set(row.id, row);
    let stage = "card lookup", cardAvailable = false;
    try {
      if (!(await this.#storedCards(person, true)).length) throw new AgentcardError("Your Vault has no stored card. Add one from Settings > Messaging & payments; never send card details in chat.");
      cardAvailable = true; stage = "registry initialization";
      const vault = await this.#client();
      assertActive();
      stage = "browser connection";
      const page = await open(); row.page = page;
      assertActive();
      stage = "interception attachment";
      const attach = (opts: Parameters<typeof attachToCdp>[2]) => this.#options.attach ? this.#options.attach(page.cdp, page.sessionId, opts)
        : page.playwright ? attachToPlaywright(page.playwright, opts) : attachToCdp(page.cdp, page.sessionId, opts);
      row.controller = await attach({
        vault, user: this.#user(person)!, merchant: row.merchant, amount: row.amount, currency: row.currency,
        serviceWorkers: "bypass", requireMerchantResult: true,
        onApprovalUrl: url => { row.approvalUrl = privateAgentcardUrl(url); this.#secrets.add(url); },
        onStateChange: state => { row.state = state; if (state.status !== "awaiting_approval") row.approvalUrl = null; },
        resolveMerchantResult: async () => {
          const result = await page.merchantResult(row.merchant, row.amount, row.currency, row.receipt);
          row.merchantConfirmed = result.status === "completed";
          return result;
        },
      });
      assertActive();
      stage = "merchant navigation";
      await page.navigate(args.url);
      assertActive();
      return { ...this.#safe(row), tab: page.tab, browserControl: page.browse ? "checkout" : "browser", placeholder: { number: "4242424242424242", expiry: "12/40", cvc: "123" },
        instructions: "Use only this placeholder card in this tab. Approval appears privately in the person's Omagent window. After submitting, call reconcile and check merchantConfirmed before reporting an order placed." };
    } catch (error) {
      row.controller?.cancel();
      row.state = row.controller?.getState() ?? { status: "failed", authorizationId: null };
      row.approvalUrl = null;
      await row.page?.close().catch(() => {});
      throw error instanceof AgentcardError ? error : new AgentcardError(`Checkout setup did not finish at ${stage}.${cardAvailable ? " The saved Omagent Vault card was found." : ""} Do not submit payment. Check the merchant before retrying if a payment was already attempted.`);
    }
  }

  #safe(row: Purchase): object {
    return { id: row.id, status: row.state.status, merchant: row.merchant, amount: row.amount, currency: row.currency,
      merchantConfirmed: row.state.status === "completed" && row.merchantConfirmed,
      ...(row.state.status === "completed" && row.merchantConfirmed ? { orderId: row.state.orderId } : {}),
      ...(row.state.status === "awaiting_approval" ? { instruction: "The person must approve in their Omagent window. Never open or request their approval link." } : {}) };
  }

  async close(): Promise<void> {
    for (const row of this.#purchases.values()) { row.controller?.cancel(); await row.page?.close().catch(() => {}); }
    this.#unscrub(); this.#secrets.clear();
  }
}

function privateAgentcardUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["vault.agentcard.sh", "vault.agentcard.com", "agentcard.sh", "agentcard.com", "app.agentcard.sh", "app.agentcard.com"].includes(url.hostname) || url.username || url.password || url.port) {
    throw new AgentcardError("Agentcard returned an unrecognized private link.", 502);
  }
  return value;
}
