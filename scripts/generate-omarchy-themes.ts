import { writeFileSync } from "node:fs";
import { OMARCHY_PALETTES } from "../src/lib/omarchy-palettes.ts";
import { omarchySkinCss } from "../src/lib/omarchy-theme.ts";

const fallback = OMARCHY_PALETTES.find(palette => palette.id === "tokyo-night")!;
const css = [omarchySkinCss("omarchy", fallback), ...OMARCHY_PALETTES.map(palette => omarchySkinCss(`omarchy-${palette.id}`, palette))].join("\n\n");
writeFileSync(new URL("../src/omarchy-skins.css", import.meta.url), css + "\n");
const chrome = Object.fromEntries(OMARCHY_PALETTES.map(palette => [`omarchy-${palette.id}`, { color: palette.background, symbolColor: palette.foreground }]));
writeFileSync(new URL("../electron/omarchy-skin-chrome.json", import.meta.url), JSON.stringify(chrome, null, 2) + "\n");
