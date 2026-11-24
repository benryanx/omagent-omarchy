import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const snapshot = mkdtempSync(join(tmpdir(), "omagent-source-secret-scan-"));
try {
  const names = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
  for (const name of new Set(names)) {
    const source = join(root, name);
    const local = relative(root, source);
    if (isAbsolute(name) || local.startsWith("..") || lstatSync(source).isSymbolicLink()) throw new Error(`Unsafe source path: ${name}`);
    const destination = join(snapshot, local);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  const scan = spawnSync(process.env.OMAGENT_GITLEAKS_BINARY || "gitleaks", ["dir", ".", "--redact", "--no-banner"], { cwd: snapshot, stdio: "inherit" });
  if (scan.error) throw new Error("Install gitleaks 8.30.1 or set OMAGENT_GITLEAKS_BINARY before running the source secret scan.");
  process.exitCode = scan.status ?? 1;
} finally { rmSync(snapshot, { recursive: true, force: true }); }
