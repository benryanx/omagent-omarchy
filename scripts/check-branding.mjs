import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const names = [["ma", "us"].join(""), ["open", "grokbot"].join(""), ["milind", "-soni"].join(""), ["soni", ".mil2001@gmail.com"].join("")];
const forbidden = new RegExp(names.join("|"), "i");
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
const failures = [];
for (const file of new Set(files)) {
  if (file === "NOTICE" || !existsSync(join(root, file))) continue;
  const bytes = readFileSync(join(root, file));
  if (forbidden.test(file) || (!bytes.includes(0) && forbidden.test(bytes.toString("utf8")))) failures.push(file);
}
if (failures.length) {
  console.error(`Unexpected upstream branding in:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else console.log("branding check passed; original attribution remains in NOTICE");
