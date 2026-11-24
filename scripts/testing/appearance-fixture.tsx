import { useState } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, type Bot } from "../../src/state/store";
import { BotProfileAvatarCard } from "../../src/components/BotProfileAvatarCard";
import { ThemeRow } from "../../src/components/ThemeRow";
import { SkinPicker } from "../../src/components/SkinPicker";
import { applySkinChoice, readSkinChoice } from "../../src/lib/skins";
import type { AvatarPatch } from "../../src/components/avatar-editing";
import "../../src/styles.css";

applySkinChoice(readSkinChoice());
const response = await fetch("/api/bots");
if (!response.ok) throw new Error(`Fixture bots: ${response.status}`);
const { bots } = await response.json() as { bots: Bot[] };
const initial = bots.find(bot => bot.name === "Appearance fixture");
if (!initial) throw new Error("Create the isolated appearance bot first");

function Fixture() {
  const [bot, setBot] = useState<Bot>(initial!);
  const patch = async (value: AvatarPatch) => {
    const response = await fetch(`/api/bots/${bot.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    if (!response.ok) throw new Error(`Profile save: ${response.status}`);
    const { bots } = await fetch("/api/bots").then(r => r.json()) as { bots: Bot[] };
    setBot(bots.find(item => item.id === bot.id)!);
  };
  return <StoreProvider><main className="min-h-screen bg-app p-6 text-ink"><h1 className="mb-5 text-xl">Appearance verification</h1><div className="grid grid-cols-[360px_1fr] gap-6"><div data-fixture-avatar data-body={bot.mascotBody} data-color={bot.color}><BotProfileAvatarCard bot={bot} activeState="idle" mascotMotion={null} onPatch={value => void patch(value)} /></div><div><ThemeRow /><SkinPicker /></div></div></main></StoreProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
