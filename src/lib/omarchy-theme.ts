import { OMARCHY_PALETTES } from "./omarchy-palettes.ts";

export type OmarchyPalette = { mode: "dark" | "light"; background: string; dark_background: string; lighter_background: string; foreground: string; light_foreground: string; accent: string; selection: string; red: string; yellow: string; green: string; cyan: string; blue: string; magenta: string };
export type OmarchyTheme = { name: string; colors: OmarchyPalette };
export const OMARCHY_SKIN_IDS = OMARCHY_PALETTES.map(palette => `omarchy-${palette.id}` as const);

function mix(color: string, toward: string, weight: number): string {
  return "#" + [1, 3, 5].map(at => Math.round(parseInt(color.slice(at, at + 2), 16) * (1 - weight) + parseInt(toward.slice(at, at + 2), 16) * weight).toString(16).padStart(2, "0")).join("");
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map(at => {
    const v = parseInt(color.slice(at, at + 2), 16) / 255;
    return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + .05) / (dark + .05);
}

function readable(color: string, backgrounds: string[], ratio = 4.5): string {
  if (backgrounds.every(bg => contrast(color, bg) >= ratio)) return color;
  const end = luminance(backgrounds[0]) > .179 ? "#000000" : "#ffffff";
  for (let step = 1; step <= 100; step++) {
    const candidate = mix(color, end, step / 100);
    if (backgrounds.every(bg => contrast(candidate, bg) >= ratio)) return candidate;
  }
  return end;
}

export function omarchyThemeTokens(p: OmarchyPalette): Record<string, string> {
  const separate = (color: string, others: string[], ratio: number) => {
    const toward = p.mode === "dark" ? "#ffffff" : "#000000";
    for (let step = 0; step <= 100; step++) {
      const candidate = mix(color, toward, step / 100);
      if (others.every(other => contrast(candidate, other) >= ratio)) return candidate;
    }
    return toward;
  };
  const panel = separate(p.dark_background, [p.background], 1.06);
  const raised = p.lighter_background;
  const hover = separate(p.selection, [panel], 1.06);
  const control = separate(raised, [panel, p.background, hover], 1.08);
  const surfaces = [p.background, panel, raised, p.selection, hover, control];
  const ink = readable(p.foreground, surfaces);
  const secondary = readable(p.light_foreground, surfaces);
  const accent = readable(p.accent, [p.background], 3);
  const onAccent = contrast("#ffffff", accent) >= contrast("#000000", accent) ? "#ffffff" : "#000000";
  const tokens: Record<string, string> = {
    "--code-color-scheme": p.mode,
    "--color-app": p.background, "--color-panel": panel, "--color-raised": raised,
    "--color-raised-hover": hover, "--color-composer": panel, "--color-composer-ring": p.selection,
    "--color-card": panel, "--color-menu": panel,
    "--color-menu-hover": "color-mix(in srgb, var(--color-raised) 70%, transparent)", "--color-menu-active": p.selection,
    "--color-inset": p.background, "--color-control": control, "--color-hairline": readable(mix(p.background, ink, .3), [p.background], 1.5),
    "--color-ink": ink, "--color-ink-secondary": secondary, "--color-ink-tertiary": secondary,
    "--color-accent": accent, "--color-accent-border": readable(p.accent, surfaces, 3), "--color-accent-text": readable(p.accent, surfaces),
    "--color-accent-ink": onAccent, "--color-focus": readable(p.accent, surfaces, 3),
    "--color-bubble-user": p.selection, "--color-bubble-user-ink": readable(p.foreground, [p.selection]),
    "--color-success": readable(p.green, surfaces), "--color-danger": readable(p.red, surfaces),
    "--color-danger-ink": contrast("#ffffff", readable(p.red, surfaces)) >= 4.5 ? "#ffffff" : "#000000",
    "--color-success-ink": contrast("#ffffff", readable(p.green, surfaces)) >= 4.5 ? "#ffffff" : "#000000",
    "--color-warning": readable(p.yellow, surfaces), "--color-scrollbar": readable(mix(p.background, ink, .35), [p.background], 1.5),
    "--color-omagent-line": ink, "--color-edge": `${ink}0f`, "--color-frame": panel,
    "--font-sans": '"Geist Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    "--radius-xs": "2px", "--radius-sm": "4px", "--radius-md": "6px", "--radius-lg": "8px", "--radius-xl": "12px", "--radius-2xl": "14px", "--radius-3xl": "16px", "--radius-4xl": "18px",
    "--identity-green": p.green, "--identity-blue": p.blue, "--identity-red": p.red, "--identity-orange": p.yellow,
    "--identity-purple": p.magenta, "--identity-cyan": p.cyan, "--identity-pink": p.magenta, "--identity-yellow": p.yellow,
    "--identity-teal": p.cyan, "--identity-coral": p.red, "--identity-silver": p.foreground, "--identity-chrome": p.foreground,
    "--omarchy-mascot-ink": p.mode === "light" ? "#000000" : "#ffffff",
  };
  for (const color of ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral", "silver", "chrome"]) {
    tokens[`--identity-${color}-ink`] = luminance(tokens[`--identity-${color}`]) > .179 ? "#000000" : "#ffffff";
  }
  return tokens;
}

export function omarchySkinCss(id: string, palette: OmarchyPalette): string {
  return `:root[data-skin="${id}"],\n[data-skin="${id}"] {\n${Object.entries(omarchyThemeTokens(palette)).map(([key, value]) => `  ${key}: ${value};`).join("\n")}\n}`;
}
