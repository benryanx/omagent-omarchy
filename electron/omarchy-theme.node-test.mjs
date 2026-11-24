import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { followOmarchyTheme, readOmarchyTheme } from "./omarchy-theme.mjs";

const source = readFileSync(new URL("../src/lib/omarchy-palettes.ts", import.meta.url), "utf8");
const palettes = JSON.parse(source.split(" = ")[1].split(" as const;")[0]);

test("reads only palette data and follows atomic theme replacement in an isolated home", async () => {
  const home = mkdtempSync(join(tmpdir(), "omagent-theme-test-"));
  const current = join(home, ".local/state/omarchy/current");
  mkdirSync(join(current, "theme"), { recursive: true });
  const write = palette => {
    const toml = Object.entries(palette).filter(([key]) => !["id", "name"].includes(key)).map(([key, value]) => `${key} = "${value}"`).join("\n");
    writeFileSync(join(current, "next.toml"), toml);
    renameSync(join(current, "next.toml"), join(current, "theme/colors.toml"));
    writeFileSync(join(current, "theme.name"), palette.id);
  };
  let watcher;
  try {
    assert.equal(readOmarchyTheme(home, "linux"), null);
    write(palettes[0]);
    assert.equal(readOmarchyTheme(home, "darwin"), null);
    assert.equal(readOmarchyTheme(home, "linux").colors.blue, palettes[0].blue);
    const updates = [];
    watcher = followOmarchyTheme(theme => updates.push(theme), { home, platform: "linux", interval: 10 });
    write(palettes[1]);
    for (let i = 0; updates.length === 0 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(updates[0]?.name, palettes[1].id);
    assert.equal(updates[0]?.colors.background, palettes[1].background);
    writeFileSync(join(current, "theme/colors.toml"), 'mode = "dark"\nbackground = "url(bad)"');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(updates.length, 1);
    assert.equal(readOmarchyTheme(home, "linux"), null);
    assert.equal(watcher.current().name, palettes[1].id);
  } finally { watcher?.stop(); rmSync(home, { recursive: true, force: true }); }
});
