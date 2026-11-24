import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const COLORS = ["background", "dark_background", "lighter_background", "foreground", "light_foreground", "accent", "selection", "red", "yellow", "green", "cyan", "blue", "magenta"];

export function readOmarchyTheme(home = homedir(), platform = process.platform) {
  if (platform !== "linux") return null;
  for (const root of [join(home, ".local/state/omarchy/current"), join(home, ".config/omarchy/current")]) {
    try {
      const source = readFileSync(join(root, "theme/colors.toml"), "utf8");
      if (source.length > 65536) continue;
      const values = Object.fromEntries([...source.matchAll(/^([a-z_]+)\s*=\s*["']([^"'\r\n]+)["']\s*(?:#.*)?$/gm)].map(([, key, value]) => [key, value]));
      if (!["light", "dark"].includes(values.mode) || COLORS.some(key => !/^#[\da-f]{6}$/i.test(values[key] ?? ""))) continue;
      const colors = Object.fromEntries(COLORS.map(key => [key, values[key]]));
      colors.mode = values.mode;
      let name = "Omarchy";
      try { name = readFileSync(join(root, "theme.name"), "utf8").trim().slice(0, 100) || name; } catch {}
      return { name, colors };
    } catch {}
  }
  return null;
}

export function followOmarchyTheme(onChange, { home = homedir(), platform = process.platform, interval = 1000 } = {}) {
  let theme = readOmarchyTheme(home, platform);
  let previous = JSON.stringify(theme);
  const timer = platform === "linux" ? setInterval(() => {
    const next = readOmarchyTheme(home, platform);
    if (!next) return;
    const value = JSON.stringify(next);
    if (value === previous) return;
    theme = next;
    previous = value;
    onChange(next);
  }, interval) : null;
  timer?.unref();
  return { current: () => theme, stop: () => { if (timer) clearInterval(timer); } };
}
