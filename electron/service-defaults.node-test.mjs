import assert from "node:assert/strict";
import test from "node:test";
import { managedComposioBrokerUrl } from "./managed-composio.mjs";
import { resolveCompanionControlPlaneURL } from "./companion-account-service.mjs";
import { createCloudAccountClient } from "./cloud-account.mjs";

test("packaged Omagent has no inherited broker or account service", () => {
  assert.equal(managedComposioBrokerUrl(undefined, true), "");
  assert.equal(resolveCompanionControlPlaneURL({ isPackaged: true, environment: {} }), "");
  assert.equal(managedComposioBrokerUrl("https://apps.example.test", true), "https://apps.example.test");
});

test("an unconfigured Cloud dashboard does not open a hosted service", async () => {
  const client = createCloudAccountClient({ store: {}, openBrowser: () => assert.fail("must not open a browser") });
  await assert.rejects(client.openDashboard(), /not available yet/);
});
