// Side-effect import that scrubs ambient OMAGENT env before a module snapshots it (scripts/mcp-server.ts reads
// OMAGENT_URL / OMAGENT_PORT at evaluation). Import order is the contract: keep it above the module under test.
import { isAmbientOmagentKey } from "./omagent-env.ts";

for (const key of Object.keys(process.env)) {
  if (isAmbientOmagentKey(key)) delete process.env[key];
}
