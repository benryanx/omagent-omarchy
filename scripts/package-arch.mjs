import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const payload = join(root, "release/linux-unpacked");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Arch preview packaging requires Linux x86_64.");
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(version)) throw new Error("Invalid release version.");
if (!existsSync(join(payload, "omagent"))) throw new Error("Build the Linux unpacked app first.");
const scratch = join(root, ".omagent-scratch");
mkdirSync(scratch, { recursive: true, mode: 0o700 });
const work = mkdtempSync(join(scratch, "arch-package-"));
const checksum = file => createHash("sha256").update(readFileSync(file)).digest("hex");
try {
  copyFileSync(join(root, "packaging/arch/PKGBUILD"), join(work, "PKGBUILD"));
  copyFileSync(join(root, "packaging/arch/omagent.desktop"), join(work, "omagent.desktop"));
  copyFileSync(join(root, "build/icon.svg"), join(work, "omagent.svg"));
  execFileSync("tar", ["--zstd", "-cf", join(work, "omagent-payload.tar.zst"), "--transform=s,^,payload/,", "-C", payload, "."], { stdio: "inherit" });
  execFileSync("makepkg", ["--force", "--nodeps", "--noconfirm", "--cleanbuild"], {
    cwd: work, stdio: "inherit", env: { ...process.env,
      PKGDEST: join(root, "release"),
      OMAGENT_PACKAGE_VERSION: version.replaceAll("-", "_"),
      OMAGENT_PAYLOAD_SHA256: checksum(join(work, "omagent-payload.tar.zst")),
      OMAGENT_DESKTOP_SHA256: checksum(join(work, "omagent.desktop")),
      OMAGENT_ICON_SHA256: checksum(join(work, "omagent.svg")),
    },
  });
} finally { rmSync(work, { recursive: true, force: true }); }
