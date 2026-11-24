import type { IncomingMessage } from "node:http";
import type { RequestAuth } from "../request-auth.ts";
import { AgentcardError, type AgentcardVault } from "../agentcard.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { z } from "zod";

const enrollmentSchema = z.object({ intent: z.enum(["connect", "add", "auto_approval"]).default("connect") }).strict();

export function createAgentcardRoutes(vault: AgentcardVault, personFor: (auth: RequestAuth, req: IncomingMessage) => string | null): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!/^\/api\/integrations\/agentcard(?:\/(?:enroll|credentials))?$/.test(path)) return PASS;
    res.setHeader("cache-control", "no-store");
    const person = personFor(auth, req);
    if (!person) return json(res, 403, { error: "Open Agentcard in your signed-in Omagent app." });
    const status = async () => ({ ...await vault.status(person), canConfigure: auth.scopes.includes("admin") });
    try {
      if (path.endsWith("/credentials") && method === "PUT") {
        if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Only the workspace owner or an administrator can configure Agentcard credentials." });
        await vault.configure(await readBody(req, 16_384));
        return json(res, 200, await status());
      }
      if (path.endsWith("/enroll") && method === "POST") {
        const checked = enrollmentSchema.safeParse(await readBody(req, 1024));
        if (!checked.success) return json(res, 400, { error: "Choose connect, add or auto_approval for your own Vault setup." });
        await vault.enroll(person, checked.data.intent);
        return json(res, 200, await status());
      }
      if (path === "/api/integrations/agentcard" && method === "GET") return json(res, 200, await status());
      return json(res, 405, { error: "method not allowed" });
    } catch (error) {
      return json(res, error instanceof AgentcardError ? error.status : 502, { error: error instanceof AgentcardError ? error.message : "Agentcard is unavailable. Please try again." });
    }
  };
}
