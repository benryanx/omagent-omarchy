import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { developmentEnvironment, developmentProfile } from "../electron/development-profile.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = developmentProfile({ ...process.env, OMAGENT_MANAGED_DEV: "1" });
const environment = developmentEnvironment(profile);
const require = createRequire(import.meta.url);
const electron = require("electron");
const { values } = parseArgs({ options: { "debug-port": { type: "string" } } });
const debugPort = values["debug-port"] ? Number(values["debug-port"]) : null;
if (debugPort !== null && (!Number.isInteger(debugPort) || debugPort < 1024 || debugPort > 65535 || [profile.port, profile.port + 1, profile.uiPort].includes(debugPort))) throw new Error("Choose a separate valid debugging port");
for (const directory of [profile.root, profile.logs]) mkdirSync(directory, { recursive: true, mode: 0o700 });
const lock = join(profile.root, "launcher.json");
let existing;
try { existing = JSON.parse(readFileSync(lock, "utf8")); } catch {}
if (existing?.pid && existing.root === profile.root) {
  try {
    process.kill(existing.pid, 0);
    if (!existing.desktopPid) process.exit(0);
    const focus = spawn(electron, [root], { cwd: root, env: environment, stdio: "ignore", detached: true });
    focus.unref();
    process.exit(0);
  } catch {}
}
if (existsSync(lock)) unlinkSync(lock);
writeFileSync(lock, JSON.stringify({ pid: process.pid, root: profile.root }), { flag: "wx", mode: 0o600 });
const clearLock = () => {
  try { if (JSON.parse(readFileSync(lock, "utf8")).pid === process.pid) unlinkSync(lock); } catch {}
};
process.once("exit", clearLock);
Object.assign(process.env, environment);
let vite, desktop, closing;
const close = (code = 0) => closing ??= (async () => {
  if (desktop?.exitCode === null) {
    desktop.kill("SIGTERM");
    await Promise.race([new Promise(resolve => desktop.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 12_000))]);
    if (desktop.exitCode === null) desktop.kill("SIGKILL");
  }
  await vite?.close();
  clearLock();
  process.exitCode = code;
})();
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
try {
  vite = await createServer({ root, configFile: join(root, "vite.config.ts"), server: { host: "127.0.0.1", port: profile.uiPort, strictPort: true } });
  await vite.listen();
  const log = openSync(join(profile.logs, "desktop.log"), "a", 0o600);
  desktop = spawn(electron, [...(debugPort ? [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${debugPort}`] : []), root], { cwd: root, env: environment, stdio: ["ignore", log, log] });
  writeFileSync(lock, JSON.stringify({ pid: process.pid, root: profile.root, desktopPid: desktop.pid }), { mode: 0o600 });
  closeSync(log);
  desktop.once("error", error => { console.error(error.message); void close(1); });
  desktop.once("exit", code => void close(code ?? 0));
  console.log(`Omagent Dev: http://127.0.0.1:${profile.uiPort}\nData: ${profile.data}\nLogs: ${profile.logs}`);
} catch (error) {
  console.error(error.message);
  await close(1);
}
