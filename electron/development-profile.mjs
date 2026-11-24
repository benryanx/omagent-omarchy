import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export function developmentProfile(env = process.env) {
  if (env.OMAGENT_MANAGED_DEV !== "1") return null;
  const root = env.OMAGENT_DEV_ROOT || join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "omagent-dev");
  if (!isAbsolute(root)) throw new Error("Omagent Dev needs an absolute profile directory");
  const port = Number(env.OMAGENT_DEV_SERVER_PORT || 18889);
  const uiPort = Number(env.OMAGENT_DEV_UI_PORT || 15199);
  if (![port, uiPort].every(Number.isSafeInteger) || port < 1024 || port > 65534 || uiPort < 1024 || uiPort > 65535 || [port, port + 1].includes(uiPort)) {
    throw new Error("Omagent Dev needs separate valid server, webhook, and interface ports");
  }
  return { root: resolve(root), data: join(root, "data"), profile: join(root, "profile"), logs: join(root, "logs"), port, uiPort };
}

export function developmentEnvironment(profile, env = process.env) {
  const next = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("OMAGENT_")));
  return {
    ...next,
    OMAGENT_MANAGED_DEV: "1",
    OMAGENT_DEV_ROOT: profile.root,
    OMAGENT_DEV_SERVER_PORT: String(profile.port),
    OMAGENT_DEV_UI_PORT: String(profile.uiPort),
    OMAGENT_DATA_DIR: profile.data,
    OMAGENT_PORT: String(profile.port),
    OMAGENT_WEBHOOK_PORT: String(profile.port + 1),
    OMAGENT_WARM_SUMMARY: "0",
    OMAGENT_ENABLE_UPDATES: "0",
    OMAGENT_ENABLE_TEAM_LIBRARY: "0",
    ELECTRON_START_URL: `http://127.0.0.1:${profile.uiPort}`,
  };
}
