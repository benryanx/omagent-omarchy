import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omagent.ts";
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentcardStatus } from "../shared/agentcard.ts";

it("serves private Vault setup from the real isolated host and refuses enrollment without credentials", async () => {
  const fixture = await launchVerificationServer();
  try {
    const response = await fetch(`${fixture.info.url}/api/integrations/agentcard`);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ configured: false, credentialSource: null, canConfigure: true, linked: false, cards: [], enrollment: null, checkouts: [] });
    const enrollment = await fetch(`${fixture.info.url}/api/integrations/agentcard/enroll`, { method: "POST", headers: { "content-type": "application/json", origin: fixture.info.url }, body: "{}" });
    expect(enrollment.status).toBe(503); expect(await enrollment.json()).toEqual({ error: "Agentcard server credentials are not configured." });
    const invalid = await fetch(`${fixture.info.url}/api/integrations/agentcard/credentials`, { method: "PUT", headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify({ clientId: "bad", clientSecret: "bad" }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Enter the Client ID and Client secret values from Agentcard, without the variable names." });
    console.log(JSON.stringify({ result: "passed", fixture: fixture.info.dataDir, log: fixture.info.logPath, privateStatus: response.status, unconfiguredEnrollment: enrollment.status }));
  } finally { await fixture.close(); }
}, 60_000);

it("enrolls through the actual host, skips returning-user enrollment and adds a second card to the same Vault", async () => {
  let external = "", permissionReady = false;
  const sessions: Array<Record<string, unknown>> = [];
  const cards = [{ id: "vc_fixture", brand: "visa", last4: "4242", expiry_month: 12, expiry_year: 2040 }];
  const api = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    res.setHeader("content-type", "application/json");
    if (req.url?.endsWith("/oauth/token")) {
      const values = new URLSearchParams(body);
      expect(values.get("client_id")).toBe("fixture-sandbox-client");
      expect(values.get("client_secret")).toBe("fixture-private-sandbox-secret");
      res.end(JSON.stringify({ access_token: "fixture-access-token", expires_in: 3600 }));
    } else if (req.url?.endsWith("/vault_sessions")) {
      const session = JSON.parse(body);
      if (session.user_id) { res.statusCode = 422; res.end(JSON.stringify({ error: { code: "contact_missing" } })); return; }
      sessions.push(session); external = session.external_user_id;
      res.end(JSON.stringify({ id: `vs_fixture${sessions.length}`, url: `https://vault.agentcard.sh/v?vs=exact-private-test-link${sessions.length}`, expires_at: new Date(Date.now() + 1800_000).toISOString(), poll_interval: 3 }));
    } else if (req.url?.includes("/vault_sessions/vs_fixture")) {
      if (sessions.length === 2 && cards.length === 1) cards.push({ id: "vc_second", brand: "visa", last4: "4242", expiry_month: 12, expiry_year: 2040 });
      res.end(JSON.stringify({ status: "linked", user_id: "usr_fixture", external_user_id: external, ...(sessions.length === 3 ? { payment_permission: { ready: permissionReady } } : {}) }));
    } else if (req.url?.includes("/vault_cards?")) {
      expect(req.url).toContain("user_id=usr_fixture");
      res.end(JSON.stringify({ data: cards.map(card => ({ ...card, ...(permissionReady ? { payment_permission: { status: "active" } } : {}) })) }));
    } else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>(resolve => api.listen(0, "127.0.0.1", resolve));
  const port = (api.address() as { port: number }).port;
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({ ...process.env, OMAGENT_TEST_AGENTCARD_API: `http://127.0.0.1:${port}` });
    const request = async (path: string, method = "GET", body?: object) => {
      const response = await fetch(`${fixture!.info.url}/api/integrations/agentcard${path}`, { method, headers: { origin: fixture!.info.url, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      expect(response.status).toBe(200); return await response.json() as AgentcardStatus;
    };
    const saved = await request("/credentials", "PUT", { clientId: "fixture-sandbox-client", clientSecret: "fixture-private-sandbox-secret" });
    expect(saved).toMatchObject({ configured: true, credentialSource: "saved", canConfigure: true, linked: false });
    expect(JSON.stringify(saved)).not.toContain("fixture-private-sandbox-secret");
    const encrypted = join(fixture.info.dataDir, "agentcard-credentials.json.enc");
    expect(readFileSync(encrypted, "utf8")).not.toContain("fixture-private-sandbox-secret");
    expect(statSync(encrypted).mode & 0o777).toBe(0o600);
    const enrollment = await request("/enroll", "POST", {});
    expect(enrollment.enrollment?.url).toBe("https://vault.agentcard.sh/v?vs=exact-private-test-link1");
    expect(sessions).toHaveLength(1); expect(sessions[0].user_id).toBeUndefined(); expect(sessions[0].steps).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 3100));
    const linked = await request("");
    expect(linked).toMatchObject({ linked: true, enrollment: null, cards: [{ brand: "visa", last4: "4242" }] });
    const mappingFile = join(fixture.info.dataDir, "agentcard-vault.json");
    const firstMapping = JSON.parse(readFileSync(mappingFile, "utf8"));
    expect(Object.values(firstMapping)).toEqual(["usr_fixture"]);
    const returning = await request("/enroll", "POST", {});
    expect(sessions).toHaveLength(1); expect(returning.enrollment).toBeNull();
    const another = await request("/enroll", "POST", { intent: "add" });
    expect(another.enrollment?.url).toBe("https://vault.agentcard.sh/v?vs=exact-private-test-link2");
    expect(sessions).toHaveLength(2); expect(sessions[1]).toMatchObject({ external_user_id: sessions[0].external_user_id, steps: ["card"] });
    expect(sessions[1].user_id).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 3100));
    const twice = await request("");
    expect(twice.cards).toHaveLength(2); expect(twice.enrollment).toBeNull();
    expect(JSON.parse(readFileSync(mappingFile, "utf8"))).toEqual(firstMapping);
    const permission = await request("/enroll", "POST", { intent: "auto_approval" });
    expect(permission.enrollment).toMatchObject({ intent: "auto_approval" });
    expect(sessions[2]).toMatchObject({ external_user_id: sessions[0].external_user_id, approval_mode: "partner" });
    expect(sessions[2].steps).toBeUndefined();
    expect(sessions[2].user_id).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 3100));
    expect((await request("")).enrollment).not.toBeNull();
    permissionReady = true;
    await new Promise(resolve => setTimeout(resolve, 3100));
    const granted = await request("");
    expect(granted.enrollment).toBeNull();
    expect(granted.cards[0].autoApproval).toBe("active");
    expect(granted.cards).toHaveLength(2);
    expect(JSON.parse(readFileSync(mappingFile, "utf8"))).toEqual(firstMapping);
    console.log(JSON.stringify({ result: "passed", fixture: fixture.info.dataDir, log: fixture.info.logPath, credentialSave: "encrypted", vault: "same user, two cards", returningUserSessionCount: 1, explicitAddSessionCount: 2, network: "loopback stand-in only; passkeys not exercised" }));
  } finally {
    await fixture?.close();
    api.closeAllConnections();
    await new Promise<void>(resolve => api.close(() => resolve()));
  }
}, 60_000);
