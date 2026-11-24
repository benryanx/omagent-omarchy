/** Every supported saved body, including the primary and seasonal collections. */

import { z } from "zod";

import { MASCOT_BODY_IDS } from "./mascot-bodies.ts";
import { HALLOWEEN_BODY_IDS, type HalloweenBodyId } from "./halloween-bodies.ts";
import type { OmagentColor } from "./wire.ts";
import { ANIMAL_BODY_IDS } from "./animal-bodies.ts";
import { FESTIVE_BODY_IDS } from "./festive-bodies.ts";

export const DEFAULT_BOT_BODY = "omarchy" as const;
export const BOT_BODY_IDS = [...MASCOT_BODY_IDS, ...HALLOWEEN_BODY_IDS, "omarchy", "step", "notch", ...FESTIVE_BODY_IDS, ...ANIMAL_BODY_IDS] as const;

export type BotBodyId = (typeof BOT_BODY_IDS)[number];

export const botBodySchema = z.enum(BOT_BODY_IDS);

/** Runtime-safe read of an untrusted persisted or streamed body id. */
export function botBodyId(value: unknown): BotBodyId {
  return botBodySchema.safeParse(value).data ?? DEFAULT_BOT_BODY;
}

export function isHalloweenBody(value: unknown): value is HalloweenBodyId {
  return (HALLOWEEN_BODY_IDS as readonly unknown[]).includes(value);
}

/** The costume each bot colour wears when "Dress my bots up" is on with the Halloween skin. */
export const COSTUME_FOR_COLOR: Record<Exclude<OmagentColor, "silver" | "chrome">, HalloweenBodyId> = {
  orange: "pumpkin",
  purple: "ghost",
  teal: "witch",
  red: "bat",
  blue: "cat",
  cyan: "skull",
  green: "monster",
  yellow: "mummy",
  coral: "vampire",
  pink: "spider",
};
