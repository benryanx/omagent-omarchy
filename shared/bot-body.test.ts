import { ANIMAL_BODY_IDS } from "./animal-bodies.ts";
import { FESTIVE_BODY_IDS } from "./festive-bodies.ts";
import { describe, expect, it } from "vitest";

import { BOT_BODY_IDS, COSTUME_FOR_COLOR, botBodyId, botBodySchema, isHalloweenBody } from "./bot-body.ts";
import { HALLOWEEN_BODY_IDS } from "./halloween-bodies.ts";
import { MASCOT_BODY_IDS } from "./mascot-bodies.ts";
import { OMAGENT_COLOR_NAMES } from "./wire.ts";

describe("bot bodies", () => {
  it("accepts every gradient body and every Halloween body", () => {
    expect(BOT_BODY_IDS).toEqual([...MASCOT_BODY_IDS, ...HALLOWEEN_BODY_IDS, "omarchy", "step", "notch", ...FESTIVE_BODY_IDS, ...ANIMAL_BODY_IDS]);
    expect(new Set(BOT_BODY_IDS).size).toBe(BOT_BODY_IDS.length);
    for (const id of BOT_BODY_IDS) expect(botBodySchema.safeParse(id).success).toBe(true);
  });

  it("falls back to Omarchy for anything it does not know", () => {
    expect(botBodyId("pumpkin")).toBe("pumpkin");
    expect(botBodyId("star")).toBe("star");
    expect(botBodyId("hexagram")).toBe("omarchy");
    expect(botBodyId(undefined)).toBe("omarchy");
  });

  it("tells the Halloween bodies apart", () => {
    expect(isHalloweenBody("ghost")).toBe(true);
    expect(isHalloweenBody("cursor")).toBe(false);
    expect(isHalloweenBody(null)).toBe(false);
  });

  it("gives every bot colour but silver and chrome its own costume", () => {
    const dressed = OMAGENT_COLOR_NAMES.filter((color) => color !== "silver" && color !== "chrome");
    expect(Object.keys(COSTUME_FOR_COLOR).sort()).toEqual([...dressed].sort());
    expect(new Set(Object.values(COSTUME_FOR_COLOR)).size).toBe(dressed.length);
    for (const body of Object.values(COSTUME_FOR_COLOR)) expect(isHalloweenBody(body)).toBe(true);
  });
});
