import type { CdpLike, MerchantResult } from "@agent-cards/sdk";
import type { CheckoutPage } from "../agentcard.ts";
import type { CdpBrowser } from "./cdp/browser.ts";

export function confirmedMerchantReceipt(receipt: unknown, amount: number, currency: string): MerchantResult {
  if (!receipt || typeof receipt !== "object") return { status: "unknown" };
  const { order, status, total } = receipt as Record<string, unknown>;
  if (typeof order !== "string" || !order.trim() || order.length > 200 || typeof status !== "string" || status.length > 1000 ||
    !/\b(confirmed|placed|paid|processing|shipped|delivered)\b/i.test(status) || /\b(not|unconfirmed|unpaid|pending|awaiting|failed|declined|cancelled|canceled)\b/i.test(status) || typeof total !== "string" || total.length > 200 ||
    !new RegExp(`\\b${currency}\\b`, "i").test(total)) return { status: "unknown" };
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const values = total.replace(new RegExp(currency, "ig"), "").match(/\d[\d,]*(?:\.\d+)?/g);
  if (values?.length !== 1 || Math.abs(Number(values[0].replaceAll(",", "")) * 10 ** digits - amount) > 0.0000001) return { status: "unknown" };
  return { status: "completed", orderId: order.trim() };
}

// Agentcard's USD-only Stripe test store renders a dollar sign without an ISO currency code.
// https://shop.agentcard.sh/shop (2026-11-22); this exception never applies to other merchants.
export const AGENTCARD_DEMO_RECEIPT_SCRIPT = `(() => {
  const visible = node => node instanceof HTMLElement && node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const headings = Array.from(document.querySelectorAll("section h2")).filter(node => visible(node) && /^Order paid\\s*✓$/.test(node.innerText.trim()));
  if (headings.length !== 1) return null;
  const container = headings[0].parentElement;
  const charges = Array.from(container.querySelectorAll("dl > div")).filter(node => node.querySelector("dt")?.textContent.trim() === "charge");
  const charge = charges.length === 1 ? charges[0].querySelector("dd") : null;
  const prices = Array.from(container.querySelectorAll("p span")).filter(node => visible(node) && /^\\$[\\d,.]+$/.test(node.innerText.trim()));
  if (!visible(charge) || prices.length !== 1) return null;
  return { order: charge.innerText.trim(), status: headings[0].innerText.trim(), total: prices[0].innerText.trim(), testMode: /\\bTEST MODE\\b/.test(document.querySelector("header")?.innerText ?? "") };
})()`;

export function confirmedAgentcardDemoReceipt(url: string, receipt: unknown, amount: number, currency: string): MerchantResult {
  const current = new URL(url);
  if (current.protocol !== "https:" || !["shop.agentcard.sh", "shop.agentcard.com"].includes(current.hostname) || current.port || current.username || current.password || current.pathname !== "/shop" || currency.toLowerCase() !== "usd" || !receipt || typeof receipt !== "object") return { status: "unknown" };
  const row = receipt as Record<string, unknown>;
  if (row.testMode !== true || typeof row.order !== "string" || !/^ch_[A-Za-z0-9]{1,190}$/.test(row.order) || row.status !== "Order paid ✓" || typeof row.total !== "string" || !/^\$\d+(?:,\d{3})*\.\d{2}$/.test(row.total)) return { status: "unknown" };
  return confirmedMerchantReceipt({ order: row.order, status: row.status, total: `USD ${row.total.slice(1)}` }, amount, currency);
}

/** Reads the merchant's own order record, rather than treating an approved card token as an order. */
export function confirmedMerchantOrder(records: unknown, amount: number, currency: string): MerchantResult {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const visit = (value: unknown): MerchantResult | null => {
    if (Array.isArray(value)) {
      for (const entry of value) { const result = visit(entry); if (result) return result; }
      return null;
    }
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const type = row["@type"];
    if ((type === "Order" || (Array.isArray(type) && type.includes("Order"))) && typeof row.orderNumber === "string" && row.orderNumber.length > 0 && row.orderNumber.length <= 200 &&
      typeof row.orderStatus === "string" && /(?:^|\/)Order(?:Processing|InTransit|Delivered|PickupAvailable)$/.test(row.orderStatus) &&
      typeof row.priceCurrency === "string" && row.priceCurrency.toLowerCase() === currency.toLowerCase() &&
      (typeof row.price === "string" || typeof row.price === "number") && Number.isFinite(Number(row.price)) && Math.abs(Number(row.price) * 10 ** digits - amount) <= 0.0000001) {
      return { status: "completed", orderId: row.orderNumber };
    }
    return visit(row["@graph"]);
  };
  return visit(records) ?? { status: "unknown" };
}

export async function openCheckoutPage(browser: CdpBrowser, tabId: (targetId: string) => string): Promise<CheckoutPage> {
  const connection = browser.connection;
  const { browserContextId } = await connection.root.send<{ browserContextId: string }>("Target.createBrowserContext", { disposeOnDetach: true });
  const offs: Array<() => void> = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const off of offs) off();
    await connection.root.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
  };
  try {
    const page = await browser.newPage("about:blank", { browserContextId });
    const session = await browser.attachSession(page);
    if (!session.id) throw new Error("Checkout requires a flattened page session.");
    const cdp: CdpLike = {
      send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
        const target = sessionId === undefined ? connection.root : connection.session(sessionId);
        if (!target) return Promise.reject(new Error("Checkout browser session closed."));
        return target.send(method, params, { pageWorld: method === "Runtime.evaluate" });
      },
      on(handler) { offs.push(connection.onEvent(handler)); },
    };
    offs.push(session.onDetach(() => { void close(); }));
    return { tab: tabId(page.targetId), cdp, sessionId: session.id, close,
      navigate: async url => { if (closed) throw new Error("Checkout closed."); await page.navigate(url); await browser.bringToFront(page); },
      merchantResult: async (merchant, amount, currency, receipt) => {
        const url = new URL(page.url());
        if (url.protocol !== "https:" || url.hostname !== merchant || url.username || url.password || url.port) return { status: "unknown" };
        const records = await page.evaluate(`Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 100).flatMap(node => { try { return node.textContent.length <= 100000 ? [JSON.parse(node.textContent)] : []; } catch { return []; } })`);
        const after = new URL(page.url());
        if (after.origin !== url.origin || after.href !== url.href) return { status: "unknown" };
        const structured = confirmedMerchantOrder(records, amount, currency);
        if (structured.status === "completed") return structured;
        if (["shop.agentcard.sh", "shop.agentcard.com"].includes(url.hostname)) {
          const demo = confirmedAgentcardDemoReceipt(url.href, await page.evaluate(AGENTCARD_DEMO_RECEIPT_SCRIPT), amount, currency);
          if (page.url() !== url.href) return { status: "unknown" };
          if (demo.status === "completed") return demo;
        }
        if (!receipt) return structured;
        const fields = await page.evaluate(`(() => {
          const selectors = ${JSON.stringify(receipt)};
          const result = {};
          for (const [key, selector] of Object.entries(selectors)) {
            const nodes = document.querySelectorAll(selector);
            if (nodes.length !== 1 || !(nodes[0] instanceof HTMLElement) || !nodes[0].checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
            result[key] = nodes[0].innerText.slice(0, 1001);
          }
          return result;
        })()`);
        if (page.url() !== url.href) return { status: "unknown" };
        return confirmedMerchantReceipt(fields, amount, currency);
      },
    };
  } catch (error) { await close(); throw error; }
}
