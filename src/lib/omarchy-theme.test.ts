import { afterEach, expect, it, vi } from "vitest";
import { OMARCHY_PALETTES } from "./omarchy-palettes";
import type { OmarchyTheme } from "./omarchy-theme";

afterEach(() => vi.unstubAllGlobals());

it("migrates an old manual theme to desktop following once, then honours explicit manual choices", async () => {
  vi.resetModules();
  const stored = new Map<string, string>([["omagent-skin", "midnight"]]);
  const styles = new Map<string, { id: string; textContent: string }>();
  let changed: ((theme: OmarchyTheme) => void) | undefined;
  const initial = { name: "custom", colors: OMARCHY_PALETTES[0] };
  vi.stubGlobal("window", { omagent: { omarchyTheme: { available: true, get: async () => initial,
    onChanged: (listener: typeof changed) => { changed = listener; return () => { changed = undefined; }; } } } });
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  const root = { dataset: {} as Record<string, string> };
  vi.stubGlobal("document", { documentElement: root, getElementById: (id: string) => styles.get(id), createElement: () => ({ id: "", textContent: "" }), head: { append: (style: { id: string; textContent: string }) => styles.set(style.id, style) } });
  const skins = await import("./skins");
  expect(skins.readSkinChoice()).toBe("omarchy");
  skins.applySkinChoice(skins.readSkinChoice());
  await Promise.resolve();
  expect(stored.get("omagent-omarchy-follow-v1")).toBe("1");
  expect(root.dataset.skin).toBe("omarchy");
  expect(styles.get("omagent-omarchy-theme")?.textContent).toContain(initial.colors.background);
  changed?.({ name: "custom changed", colors: OMARCHY_PALETTES[1] });
  expect(styles.get("omagent-omarchy-theme")?.textContent).toContain(OMARCHY_PALETTES[1].background);
  const stale = changed;
  skins.applySkin("omarchy-gruvbox");
  stale?.(initial);
  expect(root.dataset.skin).toBe("omarchy-gruvbox");
  expect(stored.get("omagent-skin")).toBe("omarchy-gruvbox");
  expect(skins.readSkinChoice()).toBe("omarchy-gruvbox");
  skins.applySkinChoice("omarchy");
  expect(changed).toBeDefined();
});
