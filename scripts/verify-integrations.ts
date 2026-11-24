import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { launchVerificationServer, verificationServerEnvironment } from "./control-omagent.ts";
import { OMARCHY_PALETTES } from "../src/lib/omarchy-palettes.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidence = mkdtempSync(join(tmpdir(), "omagent-integrations-"));
const home = join(evidence, "home");
const profile = join(home, "dev");
const data = join(profile, "data");
mkdirSync(data, { recursive: true });
mkdirSync(join(home, "tmp"), { recursive: true });
const current = join(home, ".local/state/omarchy/current");
mkdirSync(join(current, "theme"), { recursive: true });
const palette = (id: string) => OMARCHY_PALETTES.find(p => p.id === id)!;
const writeTheme = (id: string) => {
  writeFileSync(join(current, "next.toml"), Object.entries(palette(id)).filter(([key]) => !["id", "name"].includes(key)).map(([key, value]) => `${key} = "${value}"`).join("\n"));
  renameSync(join(current, "next.toml"), join(current, "theme/colors.toml"));
  writeFileSync(join(current, "theme.name"), id);
};
writeTheme("tokyo-night");
const port = () => new Promise<number>((resolve, reject) => {
  const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const value = typeof address === "object" && address ? address.port : 0; server.close(() => resolve(value)); });
});
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const fixture = await launchVerificationServer();
const serverPort = Number(new URL(fixture.info.url).port);
copyFileSync(join(fixture.info.dataDir, "config.json"), join(data, "config.json"));
await fixture.close();
const uiPort = await port(), debugPort = await port();
const environment = verificationServerEnvironment(process.env, home, serverPort);
for (const key of ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) if (process.env[key]) environment[key] = process.env[key];
Object.assign(environment, { OMAGENT_DEV_ROOT: profile, OMAGENT_DEV_SERVER_PORT: String(serverPort), OMAGENT_DEV_UI_PORT: String(uiPort) });
const desktop = spawn(process.execPath, ["scripts/omagent-dev.mjs", "--debug-port", String(debugPort)], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
for (const pipe of [desktop.stdout, desktop.stderr]) pipe?.on("data", chunk => { output += chunk; });
let socket: WebSocket | undefined;
const stop = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  for (let i = 0; i < 100 && child.exitCode === null && child.signalCode === null; i++) await delay(100);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
};
try {
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 300; i++) {
    if (desktop.exitCode !== null) throw new Error(`Desktop exited: ${output}`);
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then(r => r.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
      target = targets.find(t => t.type === "page" && t.url.startsWith(`http://127.0.0.1:${uiPort}`) && !t.url.includes("/rail"));
      if (target) break;
    } catch {}
    await delay(200);
  }
  assert(target, `No desktop page: ${output}\n${readFileSync(join(profile, "logs/desktop.log"), "utf8").slice(-4000)}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket!.addEventListener("open", resolve, { once: true }));
  let next = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void }>();
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(message.error); else request.resolve(message.result);
  });
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression: string) => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  const until = async (expression: string) => {
    for (let i = 0; i < 150; i++) { try { if (await evaluate(expression)) return; } catch {} await delay(100); }
    throw new Error(`Timed out: ${expression}`);
  };
  await send("Runtime.enable");
  await until('document.querySelector("#root")?.children.length > 0');
  await send("Page.navigate", { url: `http://127.0.0.1:${uiPort}/scripts/testing/integrations-fixture.html` });
  await until('!!document.querySelector("[data-integrations-settings] input[type=password]")');
  await until("!!document.querySelector('button[aria-label=\"Connect Agentcard\"]')");
  assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Connect Telegram").disabled'), true);
  assert.equal(await evaluate('document.querySelector("input[type=password]").getAttribute("autocomplete")'), "off");
  assert.equal(await evaluate("!!document.querySelector('a[href=\"https://docs.agentcard.com/getting-started\"]')"), true);
  assert.equal(await evaluate("!!document.querySelector('a[href=\"https://t.me/BotFather\"]')"), true);
  const status = await evaluate('(async () => { const r = await fetch("/api/integrations/telegram"); return {status:r.status, data:await r.json()}; })()');
  assert.equal(status.status, 200); assert.equal(status.data.configured, false); assert.equal(status.data.available, true);
  assert.equal("token" in status.data, false);
  await until('!!document.querySelector("#agentcard-vault-title")');
  const vault = await evaluate('(async () => { const r = await fetch("/api/integrations/agentcard"); return {status:r.status, data:await r.json()}; })()');
  assert.equal(vault.status, 200); assert.equal(vault.data.configured, false); assert.deepEqual(vault.data.cards, []);
  assert.equal(await evaluate('document.querySelector("#agentcard-vault-title").closest("section").textContent.includes("First connect Omagent")'), true);
  assert.equal(await evaluate('document.querySelector("#agentcard-vault-title").closest("section").querySelectorAll("input").length'), 2);
  const capture = async (name: string) => { const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(join(evidence, name), Buffer.from(result.data, "base64")); };
  await capture("integrations.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1000, deviceScaleFactor: 1, mobile: false });
  await delay(300);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  await capture("integrations-mobile.png");
  writeFileSync(join(evidence, "receipt.json"), JSON.stringify({ result: "passed", status, responsiveWidth: 390, credentialEntry: "password", agentcard: "existing personal OAuth connector", limitation: "Setup presentation only. Fake engine and isolated home. No Telegram credentials, AgentCard sign-in or purchases." }, null, 2));
  console.log(`PASS: isolated native integration setup and 390px layout. Evidence: ${evidence}`);
} finally {
  socket?.close();
  await stop(desktop);
  writeFileSync(join(evidence, "launcher.log"), output);
}
