import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { launchVerificationServer, verificationServerEnvironment } from "./control-omagent.ts";
import { OMARCHY_PALETTES } from "../src/lib/omarchy-palettes.ts";
import { FESTIVE_BODIES } from "../shared/festive-bodies.ts";
import { MASCOT_BODIES } from "../shared/mascot-bodies.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidence = mkdtempSync(join(tmpdir(), "omagent-appearance-"));
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
  const reload = async () => {
    const origin = await evaluate("performance.timeOrigin");
    await send("Page.reload");
    await until(`performance.timeOrigin !== ${origin} && !!document.querySelector("[data-fixture-avatar]")`);
  };
  await send("Runtime.enable");
  await until('!!window.omagent?.omarchyTheme?.available');
  await until('document.querySelector("#root")?.children.length > 0');
  const created = await evaluate('(async () => { const r = await fetch("/api/bots", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Appearance fixture"})}); return {status:r.status,body:await r.json()}; })()');
  assert.equal(created.status, 201, JSON.stringify(created));
  await evaluate('localStorage.setItem("omagent-skin", "midnight"); localStorage.removeItem("omagent-omarchy-follow-v1")');
  await send("Page.navigate", { url: `http://127.0.0.1:${uiPort}/scripts/testing/appearance-fixture.html` });
  await until('!!document.querySelector("[data-fixture-avatar]")');
  assert.equal(await evaluate('document.documentElement.dataset.skin'), "omarchy");
  assert.equal(await evaluate('localStorage.getItem("omagent-omarchy-follow-v1")'), "1");
  assert.equal(await evaluate('document.querySelector("[data-legacy-skins]").open'), false);
  assert.equal(await evaluate('document.querySelector("[data-legacy-skins] summary").textContent'), "Legacy");
  assert.equal(await evaluate('!!document.querySelector(\'[data-omarchy-skins] [data-skin="midnight"]\')'), false);
  assert.equal(await evaluate('!!document.querySelector(\'[data-legacy-skins] [data-skin="midnight"]\')'), true);
  assert.equal(await evaluate('document.querySelector("[data-fixture-avatar]").dataset.body'), "omarchy");
  const names = ["Omarchy", "Circle", "Square", "Star", "Step", "Notch", "Kitten", "Dog", "Fox", "Penguin", "Santa", "Bauble", "Gift", "Bell", "Tree", "Gingerbread", "Stocking"];
  assert.equal(await evaluate('document.querySelectorAll("[data-halloween-bodies]").length'), 0);
  assert.equal(await evaluate('!!document.querySelector(\'button[aria-label="Use the Pumpkin body"]\')'), false);
  for (const name of names) {
    await evaluate(`document.querySelector('button[aria-label="Use the ${name} body"]').click()`);
    const id = name === "Square" ? "squircle" : name.toLowerCase();
    await until(`document.querySelector("[data-fixture-avatar]").dataset.body === ${JSON.stringify(id)}`);
  }
  await reload();
  await until('document.querySelector("[data-fixture-avatar]")?.dataset.body === "stocking"');
  await evaluate('document.querySelector(\'button[aria-label="Use the Circle body"]\').click()');
  await until('document.querySelector("[data-fixture-avatar]").dataset.body === "circle"');
  await evaluate('document.querySelector(\'button[aria-label="Use blue mascot color"]\').click()');
  await until('document.querySelector("[data-fixture-avatar]").dataset.color === "blue"');
  const heroPath = 'document.querySelector(\'[data-fixture-avatar] svg[aria-label="Appearance fixture"] clipPath path\').getAttribute("d")';
  assert.equal(await evaluate('document.querySelector("[data-dress-up] [role=switch]").getAttribute("aria-checked")'), "false");
  await evaluate('document.querySelector("[data-dress-up] [role=switch]").click()');
  await until(`${heroPath} === ${JSON.stringify(FESTIVE_BODIES.bauble.outline)}`);
  assert.equal(await evaluate('document.querySelector("[data-fixture-avatar]").dataset.body'), "circle");
  await reload();
  await until(`${heroPath} === ${JSON.stringify(FESTIVE_BODIES.bauble.outline)}`);
  await evaluate('document.querySelector("[data-dress-up] [role=switch]").click()');
  const circlePath = MASCOT_BODIES.circle.clip.match(/d="([^"]+)"/)![1];
  await until(`${heroPath} === ${JSON.stringify(circlePath)}`);
  assert.equal(await evaluate('document.querySelector("[data-fixture-avatar]").dataset.body'), "circle");
  writeTheme("gruvbox");
  await until(`getComputedStyle(document.documentElement).getPropertyValue("--identity-blue").trim() === ${JSON.stringify(palette("gruvbox").blue)}`);
  await evaluate('document.querySelector(\'[data-skin-preview][data-skin="omarchy-catppuccin"]\').closest("button").click()');
  await until('document.documentElement.dataset.skin === "omarchy-catppuccin"');
  writeTheme("nord");
  await delay(1500);
  assert.equal(await evaluate('document.documentElement.dataset.skin'), "omarchy-catppuccin");
  await reload();
  await until('document.documentElement.dataset.skin === "omarchy-catppuccin" && !!document.querySelector("[data-fixture-avatar]")');
  await evaluate('document.querySelector("[data-follow-omarchy]").click()');
  await until(`document.documentElement.dataset.skin === "omarchy" && getComputedStyle(document.documentElement).getPropertyValue("--identity-blue").trim() === ${JSON.stringify(palette("nord").blue)}`);
  const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(evidence, "appearance.png"), Buffer.from(image.data, "base64"));
  writeFileSync(join(evidence, "receipt.json"), JSON.stringify({ result: "passed", shapes: names, themeChanges: ["tokyo-night", "gruvbox", "nord"], manualPin: "omarchy-catppuccin", persistedShape: "circle", festiveDressUp: "opt-in, persists, restores saved shape", halloweenPicker: "hidden", nativePreload: true, isolatedHome: home }, null, 2));
  console.log(`PASS: real desktop, ${names.length} shapes save and persist, festive dress-up persists and restores, Halloween hidden, live palette updates, manual pin and reload, resume following. Evidence: ${evidence}`);
} finally {
  socket?.close();
  await stop(desktop);
  writeFileSync(join(evidence, "launcher.log"), output);
}
