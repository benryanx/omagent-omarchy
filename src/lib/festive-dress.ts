import { useSyncExternalStore } from "react";
import { isHalloweenBody, type BotBodyId } from "../../shared/bot-body";
import { isFestiveBody, type FestiveBodyId } from "../../shared/festive-bodies";
import type { OmagentColor } from "../../shared/wire";

export const FESTIVE_DRESS_KEY = "omagent-festive-dress";
export const FESTIVE_COSTUME_FOR_COLOR: Record<Exclude<OmagentColor, "silver" | "chrome">, FestiveBodyId> = {
  green: "tree", blue: "bauble", red: "gift", orange: "bell", purple: "bauble",
  cyan: "gift", pink: "stocking", yellow: "bell", teal: "stocking", coral: "gingerbread",
};
let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function readFestiveDressUp(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try { return storage()?.getItem(FESTIVE_DRESS_KEY) === "1"; } catch { return false; }
}

function onStorage(event: StorageEvent) {
  if (event.key !== FESTIVE_DRESS_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  sessionChoice = undefined;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function setFestiveDressUp(enabled: boolean): void {
  sessionChoice = enabled;
  try { storage()?.setItem(FESTIVE_DRESS_KEY, enabled ? "1" : "0"); } catch {}
  for (const listener of listeners) listener();
}

export function useFestiveDressed(): boolean {
  return useSyncExternalStore(subscribe, readFestiveDressUp, () => false);
}

export function festiveBody(body: BotBodyId | null | undefined, color: OmagentColor, dressed: boolean): BotBodyId | undefined {
  if (!dressed || isFestiveBody(body) || isHalloweenBody(body) || color === "silver" || color === "chrome") return body ?? undefined;
  return FESTIVE_COSTUME_FOR_COLOR[color];
}
