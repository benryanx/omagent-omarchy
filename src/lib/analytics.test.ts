import { describe, expect, it } from "vitest";
import { analyticsEnabled, initAnalytics, setAnalyticsEnabled, track } from "./analytics";

describe("tracking-free build", () => {
  it("cannot enable analytics", async () => {
    expect(analyticsEnabled()).toBe(false);
    setAnalyticsEnabled(true);
    expect(analyticsEnabled()).toBe(false);
    await expect(initAnalytics()).resolves.toBeUndefined();
  });

  it("keeps legacy product event calls inert", () => {
    expect(() => track("message_sent", { driver: "codex" })).not.toThrow();
  });
});
