import { hasPriorRun } from "./prior-run";
import { OMARCHY_PALETTES } from "./omarchy-palettes";
import { OMARCHY_SKIN_IDS, omarchySkinCss, type OmarchyTheme } from "./omarchy-theme";

export const SKIN_IDS = [
  "midnight",
  "atelier",
  "foundry",
  "lagoon",
  "graphite",
  "linen",
  "dusk",
  "daylight",
  "meadow",
  "pop",
  "halloween",
  "omarchy",
  ...OMARCHY_SKIN_IDS,
] as const;
export type SkinId = (typeof SKIN_IDS)[number];

export type Skin = {
  id: SkinId;
  name: string;
  tagline: string;
};

export const SKINS: readonly Skin[] = [
  { id: "midnight", name: "Midnight", tagline: "The original. Cool and dark." },
  { id: "atelier", name: "Atelier", tagline: "Daylight on paper, warm and quiet." },
  { id: "foundry", name: "Foundry", tagline: "Night shift. Dark, warm, lit in brass." },
  { id: "lagoon", name: "Lagoon", tagline: "Cool daylight. Porcelain and deep teal." },
  { id: "graphite", name: "Graphite", tagline: "Quiet charcoal and softened steel blue." },
  { id: "linen", name: "Linen", tagline: "Clean daylight with a restrained navy accent." },
  { id: "dusk", name: "Dusk", tagline: "Muted plum after dark, calm and low-key." },
  { id: "daylight", name: "Daylight", tagline: "Midnight in reverse. Near-white, ink-black bubbles." },
  { id: "meadow", name: "Meadow", tagline: "Fresh white with a calm green. The Omagent look." },
  { id: "pop", name: "Pop", tagline: "Cream paper, thick ink outlines, hard shadows. Chunky and cheerful." },
  { id: "halloween", name: "Halloween", tagline: "Plum after dark, lit in pumpkin orange. Bats optional." },
  { id: "omarchy", name: "Omarchy", tagline: "Follow the desktop theme." },
  ...OMARCHY_PALETTES.map(palette => ({ id: `omarchy-${palette.id}` as const, name: palette.name, tagline: `Omarchy · ${palette.mode}` })),
];

/** "system" follows the OS between the light and dark skins below; anything else pins one skin. */
export type SkinChoice = SkinId | "system";
export const THEME_SKINS = { light: "daylight", dark: "midnight" } as const satisfies Record<"light" | "dark", SkinId>;

export const DEFAULT_SKIN_CHOICE: SkinChoice = "system";
export const PRIOR_INSTALL_SKIN: SkinId = "midnight";

const KEY = "omagent-skin";
const OMARCHY_FOLLOW_MIGRATION = "omagent-omarchy-follow-v1";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isSkinId(value: unknown): value is SkinId {
  return SKIN_IDS.includes(value as SkinId);
}

function isSkinChoice(value: unknown): value is SkinChoice {
  return value === "system" || isSkinId(value);
}

function systemPrefersDark(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;
  } catch {
    return true;
  }
}

export function resolveSkin(choice: SkinChoice, prefersDark = systemPrefersDark()): SkinId {
  if (choice !== "system") return choice;
  return prefersDark ? THEME_SKINS.dark : THEME_SKINS.light;
}

// With storage blocked the localStorage getter itself throws, and `typeof` alone doesn't shield it.
function getStore(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readSkinChoice(): SkinChoice {
  try {
    const store = getStore();
    const stored = store?.getItem(KEY);
    if (followsOmarchyDesktop() && (store?.getItem(OMARCHY_FOLLOW_MIGRATION) !== "1" || !stored || stored === "system")) return "omarchy";
    if (isSkinChoice(stored)) return stored;
    return hasPriorRun(store) ? PRIOR_INSTALL_SKIN : DEFAULT_SKIN_CHOICE;
  } catch {
    return PRIOR_INSTALL_SKIN;
  }
}

export function readSkin(): SkinId {
  return resolveSkin(readSkinChoice());
}

let followingSystem: { query: MediaQueryList; onChange: () => void } | null = null;
const listeners = new Set<() => void>();
let desktopTheme: OmarchyTheme | null = null;
let stopDesktopTheme: (() => void) | null = null;

export function followsOmarchyDesktop(): boolean {
  return typeof window !== "undefined" && window.omagent?.omarchyTheme?.available === true;
}

function paintOmarchyTheme(theme: OmarchyTheme): void {
  desktopTheme = theme;
  let style = document.getElementById("omagent-omarchy-theme");
  if (!style) {
    style = document.createElement("style");
    style.id = "omagent-omarchy-theme";
    document.head.append(style);
  }
  style.textContent = omarchySkinCss("omarchy", theme.colors);
  if (readSkinChoice() === "omarchy") paintSkin("omarchy");
}

export function currentOmarchyThemeName(): string | null { return desktopTheme?.name ?? null; }

function followOmarchy(follow: boolean): void {
  if (!follow) { stopDesktopTheme?.(); stopDesktopTheme = null; return; }
  if (stopDesktopTheme || typeof window === "undefined" || !window.omagent?.omarchyTheme) return;
  const bridge = window.omagent.omarchyTheme;
  let active = true;
  const unsubscribe = bridge.onChanged(theme => { if (active) paintOmarchyTheme(theme); });
  stopDesktopTheme = () => { active = false; unsubscribe(); };
  void bridge.get().then(theme => { if (active && theme) paintOmarchyTheme(theme); }).catch(() => undefined);
}

export function subscribeSkin(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function paintSkin(id: SkinId): void {
  document.documentElement.dataset.skin = id;
  for (const listener of listeners) listener();
  // On Windows the caption buttons sit in a native overlay the main process paints, out of CSS's reach.
  try {
    void window.omagent?.applySkin?.(id)?.catch(() => undefined);
  } catch {
  }
}

function followSystem(follow: boolean): void {
  if (followingSystem && !follow) {
    followingSystem.query.removeEventListener("change", followingSystem.onChange);
    followingSystem = null;
  }
  if (!follow || followingSystem || typeof matchMedia !== "function") return;
  try {
    const query = matchMedia(DARK_QUERY);
    const onChange = () => paintSkin(resolveSkin("system", query.matches));
    query.addEventListener("change", onChange);
    followingSystem = { query, onChange };
  } catch {
  }
}

/** Wears a skin another page chose, without keeping it as this page's own choice or telling the app (the window's rail
 * wearing the skin of the page beside it). */
export function wearSkin(value: unknown): void {
  if (!isSkinId(value)) return;
  document.documentElement.dataset.skin = value;
  for (const listener of listeners) listener();
}

export function applySkinChoice(choice: SkinChoice): void {
  try {
    getStore()?.setItem(KEY, choice);
    if (followsOmarchyDesktop()) getStore()?.setItem(OMARCHY_FOLLOW_MIGRATION, "1");
  } catch {
  }
  followSystem(choice === "system");
  followOmarchy(choice === "omarchy");
  paintSkin(resolveSkin(choice));
}

export function applySkin(id: SkinId): void {
  applySkinChoice(id);
}
