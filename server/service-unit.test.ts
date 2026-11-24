import { describe, expect, it } from "vitest";

import {
  checkSentinelInstall, launchdPlist, sentinelCommand, sentinelLaunchdPlist, sentinelServicePlan, sentinelSystemdService, sentinelSystemdTimer,
  sentinelUnitCommand, serviceCommand, servicePlan, shippedSentinelCli, systemdUnit, unstableInstallWarning, type ServiceSpec,
} from "./service-unit.ts";

const spec: ServiceSpec = {
  node: "/usr/bin/node",
  script: "/usr/lib/node_modules/omagent/cli.js",
  serveArgs: ["--port", "8799", "--data-dir", "/home/omagent/.omagent", "--domain", "omagent.example.com", "--no-pair"],
  dataDir: "/home/omagent/.omagent",
  user: "omagent",
  home: "/home/omagent",
  bindsLowPorts: true,
  label: "agentada",
};

describe("service units", () => {
  it("runs the same serve command, with strip-types only for a checkout", () => {
    expect(serviceCommand(spec)).toEqual(["/usr/bin/node", "/usr/lib/node_modules/omagent/cli.js", "serve", ...spec.serveArgs]);
    expect(serviceCommand({ ...spec, script: "/srv/Omagent/server/omagent.ts" })[1]).toBe("--experimental-strip-types");
  });

  it("renders a systemd unit that restarts, runs as the user, and grants low ports only for --domain", () => {
    const unit = systemdUnit(spec);
    expect(unit).toContain("Description=Omagent (agentada)");
    expect(unit).toContain("User=omagent");
    expect(unit).toContain("Environment=OMAGENT_DATA_DIR=/home/omagent/.omagent");
    expect(unit).toContain("ExecStart=/usr/bin/node /usr/lib/node_modules/omagent/cli.js serve --port 8799 --data-dir /home/omagent/.omagent --domain omagent.example.com --no-pair");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("AmbientCapabilities=CAP_NET_BIND_SERVICE");
    expect(unit).toContain("WantedBy=multi-user.target");
    const local = systemdUnit({ ...spec, bindsLowPorts: false, serveArgs: ["--port", "8799", "--data-dir", "/home/omagent/.omagent"] });
    expect(local).not.toContain("CAP_NET_BIND_SERVICE");
    expect(systemdUnit({ ...spec, dataDir: "/home/omagent/My Data", serveArgs: ["--data-dir", "/home/omagent/My Data"] })).toContain('ExecStart=/usr/bin/node /usr/lib/node_modules/omagent/cli.js serve --data-dir "/home/omagent/My Data"');
  });

  it("renders a launchd agent that keeps the server alive and logs under the data dir", () => {
    const plist = launchdPlist({ ...spec, home: "/Users/omagent", dataDir: "/Users/omagent/.omagent" });
    expect(plist).toContain("<string>com.omagent.serve</string>");
    expect(plist).toContain("<string>/usr/bin/node</string>");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("<string>omagent.example.com</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("/Users/omagent/.omagent/logs/service.log");
    expect(launchdPlist({ ...spec, serveArgs: ["--label", "a & b <c>"] })).toContain("<string>a &amp; b &lt;c&gt;</string>");
  });

  it("refuses to point a service at an npx cache, and knows where each platform's file goes", () => {
    expect(unstableInstallWarning("/home/omagent/.npm/_npx/abc123/node_modules/omagent/cli.js")).toMatch(/npm install -g omagent/);
    expect(unstableInstallWarning("/usr/lib/node_modules/omagent/cli.js")).toBeNull();
    const linux = servicePlan("linux", "/home/omagent/.omagent");
    expect(linux?.installed).toBe("/etc/systemd/system/omagent.service");
    expect(linux?.activate.join("\n")).toContain("systemctl enable --now omagent");
    const mac = servicePlan("darwin", "/Users/omagent/.omagent", "/Users/omagent");
    expect(mac?.installed).toBe("/Users/omagent/Library/LaunchAgents/com.omagent.serve.plist");
    expect(mac?.activate.join("\n")).toContain("launchctl bootstrap gui/$(id -u)");
    expect(servicePlan("win32", "C:\\x")).toBeNull();
  });

  it("renders Sentinel as a launchd agent on an interval, under its own label, logging outside the data dir", () => {
    const out = "/Users/omagent/Library/Application Support/omagent-sentinel";
    const sentinel = { node: "/usr/bin/node", script: "/usr/lib/node_modules/omagent/cli.js", dataDir: "/Users/omagent/.omagent", home: "/Users/omagent", out };
    expect(sentinelCommand(sentinel)).toEqual(["/usr/bin/node", "/usr/lib/node_modules/omagent/cli.js", "sentinel", "--once", "--data-dir", "/Users/omagent/.omagent", "--out", out]);
    expect(sentinelCommand({ ...sentinel, script: "/srv/Omagent/server/omagent.ts" })[1]).toBe("--experimental-strip-types");
    const plist = sentinelLaunchdPlist(sentinel);
    expect(plist).toContain("<string>com.omagent.sentinel</string>");
    expect(plist).toContain("<key>StartInterval</key>\n\t<integer>120</integer>");
    expect(plist).toContain("<string>sentinel</string>");
    expect(plist).not.toContain("KeepAlive");
    expect(plist).toContain(`<string>${out}/sentinel.log</string>`);
    expect(plist).not.toContain(".omagent/logs");
    const mac = sentinelServicePlan("darwin", out, "/Users/omagent");
    expect(mac?.files).toEqual([{ name: "com.omagent.sentinel.plist", installed: "/Users/omagent/Library/LaunchAgents/com.omagent.sentinel.plist" }]);
    // a path with a space is one argument in the printed commands
    expect(mac?.activate[0]).toBe("mkdir -p /Users/omagent/Library/LaunchAgents && cp '/Users/omagent/Library/Application Support/omagent-sentinel/com.omagent.sentinel.plist' /Users/omagent/Library/LaunchAgents/com.omagent.sentinel.plist");
    expect(mac?.deactivate[0]).toBe("launchctl bootout gui/$(id -u)/com.omagent.sentinel");
  });

  it("renders Sentinel as a systemd user timer, with no root", () => {
    const sentinel = { node: "/usr/bin/node", script: "/usr/lib/node_modules/omagent/cli.js", dataDir: "/home/omagent/My Data", home: "/home/omagent", out: "/home/omagent/.local/state/omagent-sentinel" };
    const unit = sentinelSystemdService(sentinel);
    expect(unit).toContain("Type=oneshot");
    expect(unit).toContain('ExecStart=/usr/bin/node /usr/lib/node_modules/omagent/cli.js sentinel --once --data-dir "/home/omagent/My Data" --out /home/omagent/.local/state/omagent-sentinel');
    expect(unit).not.toContain("User=");
    expect(sentinelSystemdTimer()).toContain("OnUnitActiveSec=120s");
    expect(sentinelSystemdTimer()).toContain("WantedBy=timers.target");
    const linux = sentinelServicePlan("linux", sentinel.out, "/home/omagent");
    expect(linux?.files.map((file) => file.installed)).toEqual(["/home/omagent/.config/systemd/user/omagent-sentinel.service", "/home/omagent/.config/systemd/user/omagent-sentinel.timer"]);
    expect(linux?.activate[0]).toContain("cp /home/omagent/.local/state/omagent-sentinel/omagent-sentinel.service");
    expect(linux?.activate.join("\n")).toContain("systemctl --user enable --now omagent-sentinel.timer");
    expect(linux?.activate.join("\n")).not.toContain("sudo");
    expect(sentinelServicePlan("win32", "C:\\x")).toBeNull();
  });

  it("finds the CLI the installed desktop app ships, and runs it as Node", () => {
    const app = "/Applications/Omagent.app/Contents";
    const present = new Set([`${app}/MacOS/Omagent`, `${app}/Resources/server/omagent.js`]);
    expect(shippedSentinelCli("darwin", "/Users/omagent", (path) => present.has(path))).toEqual({ node: `${app}/MacOS/Omagent`, script: `${app}/Resources/server/omagent.js` });
    const user = "/Users/omagent/Applications/Omagent.app/Contents";
    expect(shippedSentinelCli("darwin", "/Users/omagent", (path) => path.startsWith(user))?.script).toBe(`${user}/Resources/server/omagent.js`);
    expect(shippedSentinelCli("linux", "/home/omagent", (path) => path.startsWith("/opt/Omagent/"))).toEqual({ node: "/opt/Omagent/omagent", script: "/opt/Omagent/resources/server/omagent.js" });
    // an app with its script missing, or one released before Sentinel, is no CLI for it
    expect(shippedSentinelCli("darwin", "/Users/omagent", (path) => path.endsWith("MacOS/Omagent"))).toBeNull();
    expect(shippedSentinelCli("darwin", "/Users/omagent", (path) => present.has(path), () => false)).toBeNull();
    expect(shippedSentinelCli("win32", "C:\\Users\\omagent", () => true)).toBeNull();

    const spec = { node: `${app}/MacOS/Omagent`, script: `${app}/Resources/server/omagent.js`, dataDir: "/Users/omagent/.omagent", home: "/Users/omagent", out: "/tmp/s", electronRunAsNode: true };
    expect(sentinelLaunchdPlist(spec)).toContain("<key>ELECTRON_RUN_AS_NODE</key>\n\t\t<string>1</string>");
    expect(sentinelSystemdService(spec)).toContain("Environment=ELECTRON_RUN_AS_NODE=1");
    expect(sentinelLaunchdPlist({ ...spec, electronRunAsNode: false })).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("keeps every path one quoted value in the systemd unit, and refuses one no unit can hold", () => {
    const spec = { node: "/usr/bin/node", script: "/srv/omagent/cli.js", dataDir: "/home/omagent/100% $HOME\\", home: "/home/my omagent", out: "/home/my omagent/.local/state/omagent-sentinel" };
    const unit = sentinelSystemdService(spec);
    expect(unit).toContain('Environment="HOME=/home/my omagent"');
    // % is no specifier, $ no variable, and the trailing backslash no continuation
    expect(unit).toContain('"/home/omagent/100%% $$HOME\\\\"');
    expect(sentinelUnitCommand(unit)).toEqual({ node: "/usr/bin/node", script: "/srv/omagent/cli.js" });
    expect(sentinelUnitCommand(sentinelSystemdService({ ...spec, script: "/srv/100% $x/cli.js" }))?.script).toBe("/srv/100% $x/cli.js");
    for (const bad of ["/home/omagent\n[Service]\nExecStartPre=/bin/true", "/home/omagent\r", "/home/\0omagent"]) {
      expect(() => sentinelSystemdService({ ...spec, home: bad })).toThrow(/line break or NUL/);
      expect(() => sentinelLaunchdPlist({ ...spec, dataDir: bad })).toThrow(/line break or NUL/);
    }
  });

  it("reads back what an installed unit runs, and calls it stale when either path is gone", () => {
    const spec = { node: "/opt/node & co/bin/node", script: "/srv/omagent/cli.js", dataDir: "/home/omagent/My Data", home: "/home/omagent", out: "/home/omagent/.local/state/omagent-sentinel" };
    expect(sentinelUnitCommand(sentinelLaunchdPlist(spec))).toEqual({ node: "/opt/node & co/bin/node", script: "/srv/omagent/cli.js" });
    expect(sentinelUnitCommand(sentinelSystemdService(spec))).toEqual({ node: "/opt/node & co/bin/node", script: "/srv/omagent/cli.js" });
    expect(sentinelUnitCommand("[Service]\nType=oneshot\n")).toBeNull();

    const unit = "/home/omagent/.config/systemd/user/omagent-sentinel.service";
    const timer = "/home/omagent/.config/systemd/user/omagent-sentinel.timer";
    const files = new Map([[unit, sentinelSystemdService(spec)]]);
    const fs = (present: string[]) => ({ exists: (path: string) => files.has(path) || present.includes(path), read: (path: string) => files.get(path)! });
    expect(checkSentinelInstall("linux", "/home/omagent", fs([spec.node, spec.script, timer]))).toMatchObject({ status: "ok", unit });
    expect(checkSentinelInstall("linux", "/home/omagent", fs([spec.node, timer]))).toMatchObject({ status: "stale", missing: ["/srv/omagent/cli.js"] });
    // the service without its timer never runs
    expect(checkSentinelInstall("linux", "/home/omagent", fs([spec.node, spec.script]))).toMatchObject({ status: "stale", missing: [timer] });
    expect(checkSentinelInstall("darwin", "/Users/omagent", fs([]))).toEqual({ status: "not_installed", unit: "/Users/omagent/Library/LaunchAgents/com.omagent.sentinel.plist" });
    files.set(unit, "garbage");
    expect(checkSentinelInstall("linux", "/home/omagent", fs([]))).toEqual({ status: "unreadable", unit });
    expect(checkSentinelInstall("win32", "C:\\Users\\omagent", fs([]))).toEqual({ status: "unsupported" });
  });
});
