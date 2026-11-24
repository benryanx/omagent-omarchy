# Hosted workspace access boundary

Omagent has no subscription cloud service or bundled hosted identity adapter.
Developing and deploying that service is separate work.

The core extension contract is defined in `server/hosted-contract.ts`. Hosted
configuration uses an HTTPS `OMAGENT_ADMIN_URL`, a workspace slug in
`OMAGENT_ADMIN_WORKSPACE`, and the exact HTTPS `OMAGENT_PUBLIC_URL`.
Partial configuration, a missing adapter, an expired entitlement, or an
unavailable identity authority must deny remote access. They must never fall
back to local owner access or issue unauthenticated pairing credentials.

Run the isolated core checks:

```sh
pnpm exec vitest run server/hosted-access.test.ts server/email-signin.test.ts server/sessions.test.ts server/request-auth.test.ts server/enterprise.test.ts
```

These checks use disposable state and synthetic adapters. They verify the
contract boundary and do not qualify a live hosted service. See
[shared-workspace trust](shared-workspace-trust.md) for loopback and session
scope rules.
