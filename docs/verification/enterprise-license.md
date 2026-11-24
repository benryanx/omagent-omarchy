# Optional adapter loading and license expiry

Omagent does not ship the upstream enterprise implementation. The open-source
server retains an extension boundary for separately developed adapters. No
upstream license key activates an adapter that is absent.

Run the adapter and access-boundary checks against synthetic modules:

```sh
pnpm exec vitest run server/enterprise.test.ts server/brand.test.ts
pnpm exec vitest run --no-file-parallelism server/license-expiry-api.test.ts server/hosted-access.test.ts
```

`server/enterprise.test.ts` writes disposable stand-in adapters and verifies
loading precedence, absent adapters, expiry warnings, grace periods, and the
removal of expired capabilities. `server/license-expiry-api.test.ts` runs
isolated servers with expiring synthetic adapters. No real license, account,
cloud service, or user data is required.

The standalone edition reports `{"edition":"oss"}`. A configured hosted
identity boundary remains closed without its adapter, including after expiry.
