// How this app's Electron sessions and listeners meet the local Omagent server. The server treats the app window
// as its owner only by a header the default session adds; no other session (desktop viewers, VM panes) may reach the
// server at all; and the server learns every port this app listens on, so its bots' browsers never reach them.
import { subscribe } from "node:diagnostics_channel";
import { isIP } from "node:net";

import authModule from "./desktop-server-auth.cjs";

const { DESKTOP_MUTATION_HEADER } = authModule;

function loopbackHost(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "localhost" || bare.endsWith(".localhost") || bare === "0.0.0.0" || bare === "::") return true;
  if (isIP(bare) === 4) return bare.startsWith("127.");
  return isIP(bare) === 6 && (bare === "::1" || /^::ffff:7f[0-9a-f]{2}:/.test(bare));
}

/** Whether `url` names this machine's server port, in any spelling that reaches it. */
export function targetsServer(url, serverPort) {
  try {
    const target = new URL(url);
    if (!["http:", "https:", "ws:", "wss:"].includes(target.protocol) || !loopbackHost(target.hostname)) return false;
    const port = Number(target.port || (target.protocol === "https:" || target.protocol === "wss:" ? 443 : 80));
    return port === serverPort;
  } catch {
    return false;
  }
}

/**
 * `ownerToken()` is the desktop capability, or null while there is none to send. Chromium adds the header below
 * JavaScript, on http: and ws: alike, so a shell using curl cannot impersonate the person at the desktop.
 */
export function targetsDevelopmentProxy(value, origin) {
  if (!origin) return false;
  try {
    const target = new URL(value), proxy = new URL(origin);
    return proxy.protocol === "http:" && proxy.hostname === "127.0.0.1" &&
      ["http:", "ws:"].includes(target.protocol) && target.host === proxy.host &&
      (target.pathname === "/api" || target.pathname.startsWith("/api/") || target.pathname === "/.well-known/omagent/environment");
  } catch { return false; }
}

export function installServerSessions({ app, defaultSession, serverPort, ownerToken, developmentOrigin = () => null }) {
  defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const token = ownerToken();
    let owns = false;
    try {
      const target = new URL(details.url);
      owns = token !== null && (target.protocol === "http:" || target.protocol === "ws:") &&
        target.hostname === "127.0.0.1" && (Number(target.port || 80) === serverPort() || targetsDevelopmentProxy(details.url, developmentOrigin()));
    } catch {}
    callback({ requestHeaders: owns ? { ...details.requestHeaders, [DESKTOP_MUTATION_HEADER]: token } : details.requestHeaders });
  });
  app.on("session-created", (created) => {
    if (created === defaultSession) return;
    created.webRequest.onBeforeRequest((details, callback) => callback({ cancel: targetsServer(details.url, serverPort()) || targetsDevelopmentProxy(details.url, developmentOrigin()) }));
  });
}

const ownPorts = new Set();
let reportTo = null;

function report() {
  try {
    reportTo?.postMessage({ type: "omagent:own-listeners", ports: [...ownPorts] });
  } catch {}
}

subscribe("tracing:net.server.listen:asyncEnd", ({ server }) => {
  const address = server?.address();
  if (!address || typeof address !== "object" || ownPorts.has(address.port)) return;
  ownPorts.add(address.port);
  report();
});

/** Tells a server that has just become ready which ports this app listens on, and tells it again as more open. */
export function reportOwnListeners(proc, ports = []) {
  for (const port of ports) ownPorts.add(port);
  reportTo = proc;
  report();
}
