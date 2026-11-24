import { app } from "electron";
import { mkdirSync } from "node:fs";
import { developmentEnvironment, developmentProfile } from "./development-profile.mjs";

const profile = developmentProfile();
if (profile) {
  for (const directory of [profile.data, profile.profile, profile.logs]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  Object.assign(process.env, developmentEnvironment(profile));
  app.setName("Omagent Dev");
  app.setPath("userData", profile.profile);
  app.setPath("sessionData", profile.profile);
  app.setAppLogsPath(profile.logs);
  app.commandLine.appendSwitch("class", "com.omarchy.omagent.dev");
}

await import("./main.mjs");
