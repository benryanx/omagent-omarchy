import { attachToCdp, attachToPlaywright, VaultClient } from "@agent-cards/sdk";
import { expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { CHROME, startChrome } from "./cdp/testing/real-chrome.ts";
import { openCheckoutPage } from "./agentcard.ts";
import { openPlaywrightCheckoutPage } from "./agentcard-playwright.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { testRoot } from "./cdp/testing/real-chrome.ts";
import { FixtureServer } from "./cdp/testing/fixtures.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createBrowserHost } from "../host/browser.ts";
import { browserRuntimeEnv } from "../browser-runtime.ts";
import type { AppConfig } from "../config.ts";
import { inRunningBrowser, closeBrowserSession } from "../browser-engine.ts";

const legacyBinary = process.env.OMAGENT_VERIFY_BROWSER_BINARY;

it.skipIf(!CHROME || !legacyBinary)("opens checkout through the real legacy host and SDK while retaining the daemon socket environment", async () => {
  const root = mkdtempSync(join(testRoot(), "omagent-agentcard-legacy-"));
  const runtime = join(root, "runtime"); mkdirSync(runtime, { mode: 0o700 });
  let host: ReturnType<typeof createBrowserHost> | undefined;
  let page: Awaited<ReturnType<typeof openPlaywrightCheckoutPage>> | undefined;
  vi.stubEnv("HOME", root); vi.stubEnv("USERPROFILE", root); vi.stubEnv("XDG_RUNTIME_DIR", runtime);
  const spec = { command: legacyBinary!, args: ["mcp", "--tools", "core", "--no-webmcp"], env: {
    AGENT_BROWSER_SESSION: "checkout-fixture", AGENT_BROWSER_EXECUTABLE_PATH: CHROME!, AGENT_BROWSER_HEADED: "0", AGENT_BROWSER_RESTORE_SAVE: "never",
  } };
  const env = browserRuntimeEnv(spec.env);
  try {
    await promisify(execFile)(legacyBinary!, ["open", "about:blank", "--json", "--no-webmcp"], { env, timeout: 30_000 });
    host = createBrowserHost({ cfg: { features: { browser: true } } as AppConfig,
      store: () => ({ bots: [], bot: () => null, botByThread: () => null }),
      turnResources: { free: () => true, holder: () => undefined, onClaim: () => () => {} },
      activeInternalGenerationByThread: new Map(), mintInternalCapability: () => "fixture-capability", DESKTOP_MANAGED: false, CLOUD_HOME: null, PORT: 0 });
    let preparingTurnActive = true;
    page = await host.checkoutPage("checkout-fixture", spec, () => { if (!preparingTurnActive) throw new Error("The preparing turn ended"); });
    preparingTurnActive = false;
    const vault = new VaultClient({ clientId: "fixture-only", clientSecret: "fixture-only", fetchImpl: async () => { throw new Error("Unexpected external request"); } });
    const checkout = await attachToPlaywright(page.playwright!, { vault, user: "usr_fixture", merchant: "fixture.example.com", amount: 583, currency: "usd", requireMerchantResult: true,
      resolveMerchantResult: async () => ({ status: "unknown" }) });
    expect(checkout.getState().status).toBe("idle");
    await page.playwright!.goto(`data:text/html,<h1>Legacy checkout ready</h1><button onclick="document.querySelector('h1').textContent='Mug checkout'">Buy mug</button><button>Buy thermos</button>`);
    const snapshot = await page.browse!({ operation: "read" }) as { text: string; elements: { selector: string; text: string }[] };
    expect(snapshot.text).toContain("Legacy checkout ready");
    await expect(page.browse!({ operation: "click", selector: "button" })).rejects.toThrow("matched more than one");
    expect(await page.playwright!.locator("h1").innerText()).toBe("Legacy checkout ready");
    await host.browserRuntime.agentRpc("checkout-fixture", spec, "tools/call", { name: "agent_browser_get_url", arguments: {} }, () => {});
    await page.browse!({ operation: "click", selector: snapshot.elements.find(element => element.text === "Buy mug")!.selector });
    expect(await page.browse!({ operation: "read" })).toMatchObject({ text: expect.stringContaining("Mug checkout") });
    expect(checkout.getState().status).toBe("idle");
    await page.playwright!.route("https://shop.agentcard.sh/**", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<header>VANMAN SUPPLY CO. <span>TEST MODE</span></header><section><div><h2>Order paid ✓</h2><p>Enamel Camp Mug for <span>$5.83</span>, paid with card ending <span>4242</span>. Nothing ships — the authorization was the product.</p><dl><div><dt>token</dt><dd>tok_fixture</dd></div><div><dt>charge</dt><dd>ch_fixtureReceipt</dd></div></dl><button>Buy another</button></div></section>` }));
    await page.navigate("https://shop.agentcard.sh/shop");
    expect(await page.merchantResult("shop.agentcard.sh", 583, "usd")).toEqual({ status: "completed", orderId: "ch_fixtureReceipt" });
    expect(await page.merchantResult("shop.agentcard.sh", 584, "usd")).toEqual({ status: "unknown" });
    expect(await page.merchantResult("shop.agentcard.sh", 583, "aud")).toEqual({ status: "unknown" });
    await page.playwright!.locator("dl > div").filter({ has: page.playwright!.locator("dt", { hasText: "charge" }) }).locator("dd").evaluate(node => { (node as unknown as { textContent: string }).textContent = "tok_not_a_charge"; });
    expect(await page.merchantResult("shop.agentcard.sh", 583, "usd")).toEqual({ status: "unknown" });
    checkout.cancel(); expect(checkout.getState().status).toBe("cancelled"); await page.close();
    expect(await inRunningBrowser(legacyBinary!, env, ["get", "url"])).toBeTruthy();
  } finally {
    await page?.close(); await host?.browserRuntime.closeAll();
    await closeBrowserSession(legacyBinary!, env).catch(() => {});
    vi.unstubAllEnvs(); await removeTempDir(root);
  }
}, 60_000);

it.skipIf(!CHROME)("arms the real SDK on a fresh tab of the existing Chromium without payment or another browser", async () => {
  const fixture = await startChrome("agentcard-checkout");
  try {
    const page = await openCheckoutPage(fixture.browser, id => id);
    const vault = new VaultClient({ clientId: "fixture-only", clientSecret: "fixture-only", fetchImpl: async () => { throw new Error("Unexpected external request"); } });
    const checkout = await attachToCdp(page.cdp, page.sessionId, { vault, user: "usr_fixture", merchant: "shop.example.com", amount: 2306, currency: "usd",
      serviceWorkers: "bypass", requireMerchantResult: true, resolveMerchantResult: async () => ({ status: "unknown" }) });
    expect(checkout.getState().status).toBe("idle");
    expect(fixture.trace.some(entry => entry.method === "Fetch.enable" && Array.isArray(entry.params?.patterns) && entry.params.patterns.length > 0)).toBe(true);
    expect(fixture.trace.some(entry => entry.method === "Network.setBypassServiceWorker")).toBe(true);
    await page.navigate("data:text/html,<h1>Isolated checkout fixture</h1>");
    expect((await page.merchantResult("shop.example.com", 2306, "usd")).status).toBe("unknown");
    checkout.cancel();
    await page.close();
    const regular = await fixture.browser.newPage("data:text/html,<h1>Regular browser still works</h1>");
    expect(await regular.evaluate("document.body.innerText")).toContain("Regular browser still works");
  } finally { await fixture.close(); }
}, 60_000);

it.skipIf(!CHROME)("the native driver's separate SDK session intercepts an out-of-process payment iframe", async () => {
  const fixture = await startChrome("agentcard-native-iframe");
  const shop = await FixtureServer.start();
  shop.page("/frame", `<input aria-label="Fixture card"><button onclick="pay()">Pay</button><p id="result">Not paid</p><script>
    async function pay() { const answer = await fetch('/v1/tokens', {method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'card[number]='+document.querySelector('input').value+'&card[exp_month]=12&card[exp_year]=2040&card[cvc]=123'}); document.querySelector('#result').textContent = (await answer.json()).id; }
    </script>`);
  shop.page("/shop", `<h1>Shop</h1><iframe src="${shop.crossSiteUrl("/frame")}"></iframe>`);
  shop.page("/v1/tokens", "Unexpected request");
  try {
    const page = await openCheckoutPage(fixture.browser, id => id);
    const vault = new VaultClient({ clientId: "fixture-only", clientSecret: "fixture-only", sandbox: true, fetchImpl: async () => { throw new Error("Unexpected external request"); } });
    let approve!: () => void;
    const approval = new Promise<void>(resolve => { approve = resolve; });
    const links: string[] = [];
    const authorize = vi.spyOn(vault, "authorize").mockImplementation(async input => {
      input.onAuthorizationCreated?.("cauth_fixture"); input.onApprovalUrl?.("https://vault.agentcard.sh/authorize?id=fixture-native");
      await approval;
      return { mode: "token", authorizationId: "cauth_fixture", status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "tok_native_replayed" }) };
    });
    const checkout = await attachToCdp(page.cdp, page.sessionId, { vault, user: "usr_fixture", merchant: "fixture", amount: 2306, currency: "usd", serviceWorkers: "bypass", requireMerchantResult: true,
      onApprovalUrl: url => { links.push(url); }, resolveMerchantResult: async () => ({ status: "unknown" }) });
    await page.navigate(shop.url("/shop"));
    const native = fixture.browser.pages().find(candidate => candidate.targetId === page.tab)!;
    let tree = "";
    await vi.waitFor(async () => { tree = (await native.snapshot()).tree; expect(tree).toContain('textbox "Fixture card"'); });
    const card = /textbox "Fixture card" \[ref=(e\d+)\]/.exec(tree)![1];
    await native.fill({ ref: card }, "4242424242424242");
    tree = (await native.snapshot()).tree;
    await native.click({ ref: /button "Pay" \[ref=(e\d+)\]/.exec(tree)![1] });
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(1));
    expect(links).toEqual(["https://vault.agentcard.sh/authorize?id=fixture-native"]);
    expect(shop.requests.some(url => url.endsWith("/v1/tokens"))).toBe(false);
    approve();
    const frame = native.frames.all().find(candidate => candidate.session !== native.session)!;
    await vi.waitFor(async () => expect(await native.evaluate("document.querySelector('#result').textContent", { frameId: frame.id })).toBe("tok_native_replayed"));
    expect((await checkout.reconcile()).status).not.toBe("completed");
    checkout.cancel(); await page.close();
  } finally { await fixture.close(); await shop.close(); }
}, 60_000);

it.skipIf(!CHROME)("intercepts a cross-origin card frame, privately waits for approval, reconciles and leaves the existing browser running", async () => {
  const dir = mkdtempSync(join(testRoot(), "omagent-agentcard-playwright-"));
  const host = await chromium.launchPersistentContext(dir, { executablePath: CHROME!, headless: true, chromiumSandbox: true, args: ["--remote-debugging-port=0"] });
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    if (req.url === "/frame") res.end(`<input id="card"><button onclick="pay()">Pay</button><p id="result">Not paid</p><script>
      async function pay() { const result = await fetch('/v1/tokens', {method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'card[number]='+document.querySelector('#card').value+'&card[exp_month]=12&card[exp_year]=2040&card[cvc]=123'}); document.querySelector('#result').textContent = (await result.json()).id; }
      </script>`);
    else if (req.url === "/v1/tokens") { processorRequests++; res.end("Unexpected card request"); }
    else res.end(`<h1>Fixture shop</h1><iframe id="payment" src="http://localhost:${port}/frame"></iframe>`);
  });
  let port = 0, processorRequests = 0;
  await new Promise<void>(resolve => server.listen(0, resolve));
  port = (server.address() as { port: number }).port;
  let page: Awaited<ReturnType<typeof openPlaywrightCheckoutPage>> | undefined;
  try {
    const [debugPort, path] = readFileSync(join(dir, "DevToolsActivePort"), "utf8").trim().split("\n");
    page = await openPlaywrightCheckoutPage(`ws://127.0.0.1:${debugPort}${path}`);
    const vault = new VaultClient({ clientId: "fixture-only", clientSecret: "fixture-only", sandbox: true, fetchImpl: async () => { throw new Error("Unexpected external request"); } });
    let approve!: () => void;
    const approval = new Promise<void>(resolve => { approve = resolve; });
    const privateLinks: string[] = [];
    const authorize = vi.spyOn(vault, "authorize").mockImplementation(async input => {
      expect(input.user).toBe("usr_fixture"); expect(input.amount).toBe(2306);
      input.onAuthorizationCreated?.("cauth_fixture");
      input.onApprovalUrl?.("https://vault.agentcard.sh/approve/fixture-private-link");
      await approval;
      return { mode: "token", authorizationId: "cauth_fixture", status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "tok_fixture_paid", object: "token" }) };
    });
    let orderConfirmed = false;
    const checkout = await attachToPlaywright(page.playwright!, { vault, user: "usr_fixture", merchant: "fixture", amount: 2306, currency: "usd", requireMerchantResult: true,
      onApprovalUrl: url => { privateLinks.push(url); }, resolveMerchantResult: async () => orderConfirmed ? { status: "completed", orderId: "ORDER-FIXTURE" } : { status: "unknown" } });
    await page.playwright!.goto(`http://127.0.0.1:${port}`);
    await page.browse!({ operation: "fill", frame: "#payment", selector: "#card", text: "4242424242424242" });
    await page.browse!({ operation: "click", frame: "#payment", selector: "button" });
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(1));
    expect(privateLinks).toHaveLength(1);
    expect(await page.playwright!.frameLocator("#payment").locator("#result").innerText()).toBe("Not paid");
    expect(processorRequests).toBe(0);
    approve();
    await vi.waitFor(async () => expect(await page!.playwright!.frameLocator("#payment").locator("#result").innerText()).toBe("tok_fixture_paid"));
    expect((await checkout.reconcile()).status).not.toBe("completed");
    orderConfirmed = true;
    expect(await checkout.reconcile()).toMatchObject({ status: "completed", orderId: "ORDER-FIXTURE" });
    expect(processorRequests).toBe(0);
    checkout.cancel(); await page.close();
    expect(host.browser()!.isConnected()).toBe(true);
    expect(await host.pages()[0].evaluate("1 + 1")).toBe(2);
  } finally { await page?.close(); await host.close(); await new Promise<void>(resolve => server.close(() => resolve())); await removeTempDir(dir); }
}, 60_000);
