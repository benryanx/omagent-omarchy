import assert from "node:assert/strict";
import test from "node:test";
import { developmentEnvironment, developmentProfile } from "./development-profile.mjs";
import { serverChildLaunch } from "./server-child-launch.mjs";

test("development identity requires an explicit opt-in and separate ports", () => {
  assert.equal(developmentProfile({}), null);
  const profile = developmentProfile({ OMAGENT_MANAGED_DEV: "1", OMAGENT_DEV_ROOT: "/tmp/dev-workspace" });
  assert.equal(profile.data, "/tmp/dev-workspace/data");
  assert.equal(profile.profile, "/tmp/dev-workspace/profile");
  assert.equal(profile.port, 18889);
  assert.equal(profile.uiPort, 15199);
  assert.throws(() => developmentProfile({ OMAGENT_MANAGED_DEV: "1", OMAGENT_DEV_ROOT: "relative" }));
  assert.throws(() => developmentProfile({ OMAGENT_MANAGED_DEV: "1", OMAGENT_DEV_UI_PORT: "18890" }));
});

test("development never inherits a production workspace or cloud authority", () => {
  const profile = developmentProfile({ OMAGENT_MANAGED_DEV: "1", OMAGENT_DEV_ROOT: "/tmp/dev-workspace" });
  const environment = developmentEnvironment(profile, { PATH: "/usr/bin", OMAGENT_DATA_DIR: "/real/data", OMAGENT_ADMIN_URL: "https://admin.example.test", OMAGENT_ENABLE_UPDATES: "1" });
  assert.equal(environment.OMAGENT_DATA_DIR, profile.data);
  assert.equal(environment.OMAGENT_ADMIN_URL, undefined);
  assert.equal(environment.OMAGENT_ENABLE_UPDATES, "0");
  assert.equal(environment.PATH, "/usr/bin");
  assert.equal(environment.OMAGENT_PORT, "18889");
});

test("development forks the source entry rather than an installed server", () => {
  assert.deepEqual(serverChildLaunch({ resourcesPath: "/installed/resources", userData: "/tmp/profile", sourceRoot: "/repo" }), {
    entry: "/repo/electron/dev-server-entry.mjs", compileCacheDir: null,
  });
});
