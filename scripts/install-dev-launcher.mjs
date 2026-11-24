import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { developmentProfile } from "../electron/development-profile.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const profile = developmentProfile({ ...process.env, OMAGENT_MANAGED_DEV: "1" });
const bin = join(homedir(), ".local", "bin");
const applications = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "applications");
for (const directory of [bin, applications, profile.logs]) mkdirSync(directory, { recursive: true, mode: 0o700 });
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const launcher = join(bin, "omagent-dev");
const script = `#!/usr/bin/env bash\nset -euo pipefail\numask 077\ncd ${quote(root)}\nexec ${quote(process.execPath)} ${quote(join(root, "scripts/omagent-dev.mjs"))} "$@" >>${quote(join(profile.logs, "launcher.log"))} 2>&1\n`;
if (existsSync(launcher) && readFileSync(launcher, "utf8") !== script) {
  writeFileSync(`${launcher}.backup-${Date.now()}`, readFileSync(launcher), { mode: 0o700, flag: "wx" });
}
writeFileSync(launcher, script, { mode: 0o755 });
const desktop = join(applications, "com.omarchy.omagent.dev.desktop");
writeFileSync(desktop, `[Desktop Entry]\nType=Application\nName=Omagent Dev\nComment=Latest source with a separate development workspace\nExec="${launcher}"\nTryExec=${launcher}\nIcon=${join(root, "public/app-icon.svg")}\nTerminal=false\nStartupNotify=true\nStartupWMClass=com.omarchy.omagent.dev\nCategories=Development;\n`, { mode: 0o644 });
console.log(`Installed Omagent Dev\nLauncher: ${launcher}\nDesktop entry: ${desktop}\nWorkspace: ${profile.root}`);
