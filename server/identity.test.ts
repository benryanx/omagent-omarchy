import { afterEach, expect, it, vi } from "vitest";
import { createUpdateChecker } from "./update-check.ts";
import { fetchTeamCatalog } from "./team-library.ts";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("does not contact a release feed or community catalog without explicit configuration", async () => {
  vi.stubEnv("OMAGENT_ENABLE_UPDATES", "");
  vi.stubEnv("OMAGENT_ENABLE_TEAM_LIBRARY", "");
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  expect(await createUpdateChecker({ current: "0.1.143", install: "git" })()).toMatchObject({ available: false });
  expect((await fetchTeamCatalog()).teams).toEqual([]);
  expect(network).not.toHaveBeenCalled();
});
