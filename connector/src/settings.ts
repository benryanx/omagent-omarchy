// Names, paths and limits the connector, install.sh and the e2e share. install.sh repeats the names it needs, and a
// test holds them equal.

export const CONNECTOR_VERSION = "1.0.0";

/** Docker objects the connector owns. */
export const NAMES = {
  connector: "omagent-connector",
  connectorNext: "omagent-connector-next",
  home: "omagent-home",
  dataVolume: "omagent-data",
  stateVolume: "omagent-connector",
  snapshotVolume: "omagent-snapshot",
  backupPrefix: "omagent-backup-",
} as const;

export const LABELS = {
  role: "com.omagent.role",
  instance: "com.omagent.instance",
  created: "com.omagent.created",
  image: "com.omagent.image",
  env: "com.omagent.env",
} as const;

/** Backups the connector keeps; a newer one replaces the oldest. */
export const BACKUPS_KEPT = 3;

/** Inside the connector's container. */
export const PATHS = {
  state: process.env.OMAGENT_STATE_DIR || "/state",
  docker: process.env.OMAGENT_DOCKER_SOCKET || "/var/run/docker.sock",
  /** /etc/omagent on the host, mounted read-only: the seccomp profile install.sh put there. */
  hostConfig: process.env.OMAGENT_HOST_CONFIG_DIR || "/etc/omagent",
  /** The connector's own copies, which install.sh installs from this image. */
  profiles: process.env.OMAGENT_PROFILES_DIR || "/app/profiles",
} as const;

export const SECCOMP_FILE = "seccomp-omagent-home.json";
export const APPARMOR_PROFILE = "omagent-home-narrow";

/** Where the home's edge listens on the server: loopback only, reached by the tunnel and by the connector. */
export const HOME_PORT = 8080;

/**
 * On a stock Docker host the bot box needs our AppArmor and seccomp profiles and no masked /proc paths; the home needs
 * Docker's init, shared memory for Chrome, time to stop cleanly (its launcher kills its children at 20 s), and only the
 * four capabilities its root launcher uses. No --privileged, no added capability, no restart policy: the connector
 * restarts the home.
 */
export const HOME_CAPABILITIES = ["CHOWN", "SETUID", "SETGID", "KILL"] as const;
export const HOME_STOP_TIMEOUT_S = 30;
export const HOME_SHM_BYTES = 512 * 1024 * 1024;
export const HOME_OOM_SCORE_ADJ = -800;

/** The first home image whose launcher clears another container's data-directory lease itself. */
export const LEASE_FIXED_VERSION = [0, 1, 131] as const;

export function envSeconds(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
