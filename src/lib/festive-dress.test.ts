import { afterEach, expect, it, vi } from "vitest";
import { FESTIVE_BODY_IDS } from "../../shared/festive-bodies";
import { BOT_BODY_IDS, botBodySchema } from "../../shared/bot-body";

afterEach(() => vi.unstubAllGlobals());

it("opts in, remembers the choice, and leaves saved shapes unchanged when switched off", async () => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  const dress = await import("./festive-dress");
  expect(dress.readFestiveDressUp()).toBe(false);
  dress.setFestiveDressUp(true);
  expect(values.get(dress.FESTIVE_DRESS_KEY)).toBe("1");
  expect(dress.festiveBody("step", "blue", true)).toBe("bauble");
  dress.setFestiveDressUp(false);
  expect(dress.festiveBody("step", "blue", dress.readFestiveDressUp())).toBe("step");
  expect(values.get(dress.FESTIVE_DRESS_KEY)).toBe("0");
});

it("accepts all festive shapes and preserves explicit seasonal and metal looks", async () => {
  const { festiveBody } = await import("./festive-dress");
  for (const id of FESTIVE_BODY_IDS) {
    expect(BOT_BODY_IDS).toContain(id);
    expect(botBodySchema.safeParse(id).success).toBe(true);
    expect(festiveBody(id, "blue", true)).toBe(id);
  }
  expect(festiveBody("pumpkin", "blue", true)).toBe("pumpkin");
  expect(festiveBody("omarchy", "chrome", true)).toBe("omarchy");
  expect(festiveBody(undefined, "silver", true)).toBeUndefined();
});

it("works when storage is blocked", async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  const dress = await import("./festive-dress");
  expect(dress.readFestiveDressUp()).toBe(false);
  expect(() => dress.setFestiveDressUp(true)).not.toThrow();
  expect(dress.readFestiveDressUp()).toBe(true);
});
