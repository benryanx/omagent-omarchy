import { app, BrowserWindow, session } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { WORKSPACE_BACKUP_CLIENT_KEYS } from "../shared/workspace-backup-client.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: {
  root: { type: "string" }, from: { type: "string" }, to: { type: "string" }, prefix: { type: "string", multiple: true, default: [] },
} });
if (!values.root || !values.from || !values.to) throw new Error("Specify a Dev root, source origin, and target origin");
const root = resolve(values.root);
const origins = [values.from, values.to].map(value => {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== value) throw new Error("Preference import requires exact loopback origins");
  return url.origin;
});
const profile = join(root, "profile");
mkdirSync(profile, { recursive: true, mode: 0o700 });
app.setName("Omagent Dev");
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let window;
  try {
    session.defaultSession.protocol.handle("http", request => new Response(origins.includes(new URL(request.url).origin) ? "<!doctype html><title>Preference import</title>" : "", { status: origins.includes(new URL(request.url).origin) ? 200 : 403, headers: { "content-type": "text/html" } }));
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !origins.includes(new URL(details.url).origin) }));
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await window.loadURL(origins[0]);
    const stored = await window.webContents.executeJavaScript("Object.entries(localStorage)");
    const allowed = new Set(WORKSPACE_BACKUP_CLIENT_KEYS);
    const imported = {};
    for (const [key, value] of stored) {
      const prefix = values.prefix.find(candidate => key.startsWith(`${candidate}-`) || key.startsWith(`${candidate}.`));
      const mapped = prefix ? `omagent${key.slice(prefix.length)}` : key;
      if (allowed.has(mapped)) imported[mapped] = value;
    }
    await window.loadURL(origins[1]);
    await window.webContents.executeJavaScript(`Object.entries(${JSON.stringify(imported)}).forEach(([key,value]) => localStorage.setItem(key,value))`);
    await session.defaultSession.flushStorageData();
    writeFileSync(join(root, "preferences-import.json"), JSON.stringify({ from: origins[0], to: origins[1], keys: Object.keys(imported) }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ preferencesImported: Object.keys(imported).length }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    app.quit();
  }
});
