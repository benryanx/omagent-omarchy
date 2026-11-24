import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";
import { decryptBrowserState, encryptBrowserState } from "./browser-sites.ts";

export const agentcardCredentialsSchema = z.object({
  clientId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
  clientSecret: z.string().trim().min(16).max(4096).regex(/^[\x21-\x7e]+$/),
}).strict();
export type AgentcardCredentials = z.infer<typeof agentcardCredentialsSchema>;

/** Server-only credentials, encrypted with a separate owner-only key like saved website logins. Neither file is portable. */
export class AgentcardCredentialsStore {
  readonly #file: string;
  readonly #keyFile: string;
  constructor(dataDir: string) {
    this.#file = join(dataDir, "agentcard-credentials.json.enc");
    this.#keyFile = join(dataDir, "agentcard-credentials-key");
  }
  get(): AgentcardCredentials | null {
    if (!existsSync(this.#file)) return null;
    try { return agentcardCredentialsSchema.parse(JSON.parse(decryptBrowserState(readFileSync(this.#file), this.#key(false)))); }
    catch { return null; }
  }
  put(input: AgentcardCredentials): void {
    const value = agentcardCredentialsSchema.parse(input);
    mkdirSync(join(this.#file, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.#file, encryptBrowserState(JSON.stringify(value), this.#key(true)), { mode: 0o600 });
  }
  #key(create: boolean): string {
    if (existsSync(this.#keyFile)) {
      const value = readFileSync(this.#keyFile, "utf8").trim();
      if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("The saved Agentcard credential key is invalid.");
      return value;
    }
    if (!create) throw new Error("The saved Agentcard credential key is missing.");
    const key = randomBytes(32).toString("hex");
    writeFileAtomic(this.#keyFile, `${key}\n`, { mode: 0o600 });
    return key;
  }
}
