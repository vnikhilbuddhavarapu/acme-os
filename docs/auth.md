# Auth Architecture

## Flow

```
User -> os.acme-studios.org (Cloudflare Access self-hosted app)
  Access -> Authentik (Generic OIDC identity provider)
    Authentik authenticates user, returns OIDC code
  Access exchanges code for tokens, validates, sets CF-Access-Jwt-Assertion cookie
  Access forwards request to acme-os-workshop with JWT
acme-os-workshop validates JWT (issuer + audience), extracts email
```

- **Authentik** is the OIDC Identity Provider (IdP).
- **Cloudflare Access** is the OIDC client (relying party).
- **acme-os** is a self-hosted app behind Access. It trusts the signed Access JWT and does not implement OIDC itself.
- Client ID and Client Secret live in Authentik and Access only. They are never in the repo, deployment.jsonc, or Worker code.

## Confirmed claim shape

Verified via `/cdn-cgi/access/get-identity` on `os.acme-studios.org`:

- `email`: the user's email address
- `groups`: array of display-name strings (space- and case-sensitive), e.g. `"authentik Admins"`, `"Engineering"`, `"Employees"`, `"IT"`, `"grafana-admins"`, `"ai-admins"`
- The groups array also appears under `custom.groups`

## Current backend behavior

The acme-os backend (kernel `packages/workshop-backend/src/access.ts`) reads only `email` from the verified Access JWT. It does not read groups. Groups will be consumed in Sprints 3 and 5.

## TODO for Sprint 3: groups source (JWT payload vs get-identity)

`/cdn-cgi/access/get-identity` returns a richer identity object than the raw JWT. Sprint 3's first task is to determine which source provides groups:

1. **JWT payload**: groups may be present in the `Cf-Access-Jwt-Assertion` JWT body as `accessPayload.groups` — if so, the backend can read them directly from the already-verified JWT with no extra request.
2. **get-identity only**: groups may only be available via a server-side call to `/cdn-cgi/access/get-identity` using the JWT — if so, the backend must make that call per request (or cache it) to retrieve groups.

Both options must be evaluated before implementing the metadata threading. Prefer option 1 if available (no extra network call, no added latency).

## Deferred: SCIM group sync / deprovisioning

SCIM 2.0 group sync from Authentik to Access (with deprovisioning so removing a user in Authentik ends their Access sessions) is optional and deferred to a future sprint. It is not required for Sprints 3-5, which read groups from the authenticated session. Listed as a future TODO — do not block on it.
