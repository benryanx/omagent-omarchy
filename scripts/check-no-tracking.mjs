import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const roots = ["src", "server", "electron", "companion", "shared"];
const textExtensions = new Set([".cjs", ".js", ".json", ".mjs", ".ts", ".tsx"]);
const forbidden = [
  ["PostHog dependency or endpoint", /posthog-js|us\.i\.posthog\.com/i],
  ["common telemetry SDK", /(?:from\s+|import\s*\(|require\s*\()["'](?:@sentry\/|mixpanel|segment|amplitude)/i],
];

function filesBelow(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(child) : [child];
  });
}

const failures = [];
for (const directory of roots) {
  for (const file of filesBelow(join(root, directory))) {
    if (!textExtensions.has(extname(file)) || file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const source = readFileSync(file, "utf8");
    for (const [label, pattern] of forbidden) {
      if (pattern.test(source)) failures.push(`${relative(root, file)}: ${label}`);
    }
  }
}

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const dependencies of [manifest.dependencies, manifest.devDependencies]) {
  for (const name of Object.keys(dependencies ?? {})) {
    if (/posthog|sentry|mixpanel|segment|amplitude/i.test(name)) failures.push(`package.json: tracking dependency ${name}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("privacy check passed: no tracking SDKs or endpoints in runtime sources");
}
