import { z } from "zod";
import { TelegramBridge, TelegramError } from "../telegram.ts";
import { PASS, type RouteHandler } from "./table.ts";

const configSchema = z.object({ token: z.string().max(256).optional(), botId: z.string().regex(/^[\w-]{1,128}$/), enabled: z.boolean() }).strict();

export function createTelegramRoutes(bridge: TelegramBridge): RouteHandler {
  return async ({ req, path, method, res, json, readBody }) => {
    if (!/^\/api\/integrations\/telegram(?:\/(?:pair|stop))?$/.test(path)) return PASS;
    res.setHeader("cache-control", "no-store");
    try {
      if (path.endsWith("/pair") && method === "POST") return json(res, 200, bridge.pair());
      if (path.endsWith("/stop") && method === "POST") return json(res, 200, await bridge.cancel());
      if (path === "/api/integrations/telegram") {
        if (method === "GET") return json(res, 200, bridge.status());
        if (method === "DELETE") { await bridge.disconnect(); return json(res, 200, bridge.status()); }
        if (method === "PUT") {
          const checked = configSchema.safeParse(await readBody(req, 4096));
          if (!checked.success) return json(res, 400, { error: "Choose a bot and enter a valid Telegram connection." });
          return json(res, 200, await bridge.configure(checked.data));
        }
      }
      return json(res, 405, { error: "method not allowed" });
    } catch (error) {
      return json(res, error instanceof TelegramError ? error.status : 500, { error: error instanceof TelegramError ? error.message : "Telegram settings could not be saved." });
    }
  };
}
