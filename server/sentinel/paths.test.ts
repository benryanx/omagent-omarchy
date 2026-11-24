import { describe, expect, it } from "vitest";

import { defaultSentinelOut, isInside } from "./paths.ts";

describe("sentinel paths", () => {
  it("keeps Sentinel's files in the platform's state folder, outside the data dir", () => {
    expect(defaultSentinelOut("/Users/omagent/.omagent", "darwin", "/Users/omagent", {})).toBe("/Users/omagent/Library/Application Support/omagent-sentinel");
    expect(defaultSentinelOut("/home/omagent/.omagent", "linux", "/home/omagent", {})).toBe("/home/omagent/.local/state/omagent-sentinel");
    expect(defaultSentinelOut("/home/omagent/.omagent", "linux", "/home/omagent", { XDG_STATE_HOME: "/var/state/omagent" })).toBe("/var/state/omagent/omagent-sentinel");
    // a relative XDG_STATE_HOME is invalid by the spec and ignored
    expect(defaultSentinelOut("/home/omagent/.omagent", "linux", "/home/omagent", { XDG_STATE_HOME: "state" })).toBe("/home/omagent/.local/state/omagent-sentinel");
    expect(defaultSentinelOut("C:\\Users\\omagent\\.omagent", "win32", "C:\\Users\\omagent", { LOCALAPPDATA: "D:\\Local" })).toBe("D:\\Local\\omagent-sentinel");
  });

  it("gives any other data dir its own subfolder, the same one every time", () => {
    const other = defaultSentinelOut("/srv/omagent-data", "linux", "/home/omagent", {});
    expect(other).toMatch(/^\/home\/omagent\/\.local\/state\/omagent-sentinel\/data-[0-9a-f]{12}$/);
    expect(defaultSentinelOut("/srv/omagent-data", "linux", "/home/omagent", {})).toBe(other);
    expect(defaultSentinelOut("/srv/omagent-data-2", "linux", "/home/omagent", {})).not.toBe(other);
  });

  it("knows when a folder is inside another", () => {
    expect(isInside("/d/omagent/sentinel", "/d/omagent", "linux")).toBe(true);
    expect(isInside("/d/omagent", "/d/omagent", "linux")).toBe(true);
    expect(isInside("/d/omagent-sentinel", "/d/omagent", "linux")).toBe(false);
    expect(isInside("/d", "/d/omagent", "linux")).toBe(false);
    expect(isInside("C:\\d\\omagent\\x", "C:\\d\\omagent", "win32")).toBe(true);
  });
});
