import { chromium } from "playwright-core";
import { AgentcardError, type CheckoutPage } from "../agentcard.ts";
import { AGENTCARD_DEMO_RECEIPT_SCRIPT, confirmedAgentcardDemoReceipt, confirmedMerchantOrder, confirmedMerchantReceipt } from "./agentcard.ts";

interface PageElement {
  id: string;
  tagName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
}

export async function openPlaywrightCheckoutPage(endpoint: string): Promise<CheckoutPage> {
  const url = new URL(endpoint);
  if (!["ws:", "wss:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password) {
    throw new Error("The existing browser did not return a local DevTools endpoint.");
  }
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await context?.close().catch(() => {});
      // Playwright 1.65 disconnects a connectOverCDP client here; it does not stop the existing Chromium.
      await browser.close().catch(() => {});
    };
    page.on("close", () => { void close(); });
    const allowed = (value: string) => {
      const dest = new URL(value);
      if (dest.protocol !== "https:" || dest.username || dest.password || (/agentcard\.(?:sh|com)$/.test(dest.hostname) && !/^shop\.agentcard\.(?:sh|com)$/.test(dest.hostname))) throw new Error("Use a merchant HTTPS page; Vault and approval links belong in the person's own browser.");
      return value;
    };
    const inspect = async () => ({ url: page.url(), text: (await page.locator("body").innerText()).slice(0, 16_000),
      frames: await page.locator("iframe").evaluateAll(nodes => nodes.slice(0, 30).map(value => {
        const node = value as unknown as PageElement;
        return { id: node.id, name: node.getAttribute("name"), title: node.getAttribute("title"), src: node.getAttribute("src") };
      })),
      elements: await page.locator("input,button,select,a[href]").evaluateAll(nodes => nodes.slice(0, 100).map((value, index) => {
        const node = value as unknown as PageElement;
        return { selector: `:nth-match(:is(input,button,select,a[href]), ${index + 1})`, tag: node.tagName.toLowerCase(), id: node.id, name: node.getAttribute("name"), type: node.getAttribute("type"),
          label: node.getAttribute("aria-label"), placeholder: node.getAttribute("placeholder"), text: (node.textContent ?? "").trim().slice(0, 150) };
      })) });
    return { tab: "checkout", playwright: page, sessionId: "", cdp: { send: async () => { throw new Error("Use the Playwright checkout attachment."); }, on: () => {} }, close,
      navigate: async value => { await page.goto(allowed(value), { waitUntil: "domcontentloaded" }); await page.bringToFront(); },
      browse: async input => {
        try {
          if (closed) throw new AgentcardError("The checkout tab was closed. Cancel this checkout and check its resulting status before preparing another; an unknown payment outcome must still be resolved with the merchant.");
          if (input.operation === "navigate") { if (!input.url) throw new Error("navigate requires url"); await page.goto(allowed(input.url), { waitUntil: "domcontentloaded" }); }
          else if (input.operation !== "read") {
            if (!input.selector) throw new Error("A Playwright selector is required.");
            const target = input.frame ? page.frameLocator(input.frame).locator(input.selector) : page.locator(input.selector);
            if (input.operation === "click") await target.click();
            else if (input.operation === "fill") { if (input.text === undefined) throw new Error("fill requires text"); await target.fill(input.text); }
            else { if (!input.text) throw new Error("press requires a key in text"); await target.press(input.text); }
          }
          return await inspect();
        } catch (error) {
          if (error instanceof AgentcardError) throw error;
          const message = error instanceof Error ? error.message : "";
          if (message.includes("strict mode violation")) throw new AgentcardError("The checkout selector matched more than one element. Read the checkout page, then use the unique selector returned for the intended element. The click was not performed.");
          if (error instanceof Error && error.name === "TimeoutError") throw new AgentcardError("The checkout browser action timed out. Read the current checkout page before continuing; do not repeat a payment click without checking its outcome.");
          throw new AgentcardError("The checkout page could not be read or controlled. Check status, then cancel if abandoning this checkout; an unknown payment outcome must be resolved with the merchant before retrying.");
        }
      },
      merchantResult: async (merchant, amount, currency, receipt) => {
        const before = page.url(), current = new URL(before);
        if (current.protocol !== "https:" || current.hostname !== merchant || current.username || current.password || current.port) return { status: "unknown" };
        const records = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.slice(0, 100).flatMap(value => {
          const node = value as unknown as PageElement;
          try { return node.textContent && node.textContent.length <= 100_000 ? [JSON.parse(node.textContent)] : []; } catch { return []; }
        }));
        const structured = confirmedMerchantOrder(records, amount, currency);
        if (page.url() !== before) return { status: "unknown" };
        if (structured.status === "completed") return structured;
        if (["shop.agentcard.sh", "shop.agentcard.com"].includes(current.hostname)) {
          const demo = confirmedAgentcardDemoReceipt(before, await page.evaluate(AGENTCARD_DEMO_RECEIPT_SCRIPT), amount, currency);
          if (page.url() !== before) return { status: "unknown" };
          if (demo.status === "completed") return demo;
        }
        if (!receipt) return structured;
        const fields: Record<string, string> = {};
        for (const [key, selector] of Object.entries(receipt)) {
          const node = page.locator(selector);
          if (await node.count() !== 1 || !await node.isVisible()) return { status: "unknown" };
          fields[key] = (await node.innerText()).slice(0, 1001);
        }
        return page.url() === before ? confirmedMerchantReceipt(fields, amount, currency) : { status: "unknown" };
      },
    };
  } catch (error) { await context?.close().catch(() => {}); await browser.close().catch(() => {}); throw error; }
}
