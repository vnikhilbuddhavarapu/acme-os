# Cloudflare OS — Deployment & Customization PLAN

## Notes

Owner: Nikhil Buddhavarapu (Senior SE, Cloudflare) Goal: Clone the Cloudflare OS starter, customize it end-to-end (branding/UI, agent instructions, skills/context, gatekeepers, MCPs, models routed through your AI Gateway), and deploy it to your own Cloudflare account — as a repeatable, version-controlled deployment (not the non-customizable one-click flow). Companion docs: acme-os-briefing.md (concepts), acme-os-build-plan.md (sprint sequence), acme-os-coding-guidelines.md (rules for the AI coding agent).

## 0. Strategy at a glance

- **Clone the *starter* repo (cloudflare/cloudflare-os-starter), not just the platform repo. The starter pins cloudflare-os as a git submodule** and gives you deployment.jsonc + scripts/deploy.mjs + a packages/ area for your own code — the supported way to customize without forking upstream.
- Customize in three layers, in order of increasing commitment: (1) /admin runtime settings, (2) deployment.jsonc deploy-time config, (3) wrapper-owned code in packages/.
- Two-phase rollout: Phase A get a working *evaluation* deploy on workers.dev with Access + your AI Gateway. Phase B harden to production (custom domain, context library, custom gatekeepers, MCPs, branding, observability).
- Keep upstream pristine. All your changes live in the starter repo (config + packages/), never inside the submodule.

## 1. Prerequisites & account readiness

### Toolchain (local machine)

- Node.js 24 (matches the checkout's declared version)
- pnpm 11
- Git (with submodule support)
- Wrangler (project-pinned; invoked via pnpm exec wrangler) + wrangler login

### Cloudflare account entitlements (verify these exist on your target account)

- Workers (Paid plan recommended — Durable Objects + Dynamic Workers)
- Durable Objects
- Dynamic Worker Loaders (sandboxed Gadget execution)
- KV (blueprints, avatars, context snapshots)
- R2 (blueprint-content / logo storage)
- Browser Rendering (blueprint screenshots)
- AI Gateway + provider access (for the model-routing goal) — Unified Billing or BYOK keys
- *Optional:* Artifacts (Git-backed context collections), Workers AI
- Cloudflare Access (Zero Trust) — for the default sign-in method
- A zone you control if you want a custom domain (Phase B)

> ✅ Action: Confirm your account ID and that the above products are enabled before touching config. Since you're a Cloudflare SE, confirm whether you're deploying to a personal/sandbox account or a team account — this determines Access team domain, admins list, and AI Gateway ownership.

## 2. Phase A — Evaluation deploy (get it running end-to-end)

### Step A1 — Clone with submodule

```sh git clone https://github.com/cloudflare/cloudflare-os-starter.git cd cloudflare-os-starter git submodule update --init            # pulls the pinned cloudflare-os release ```

### Step A2 — Install dependencies (both the wrapper and the submodule)

```sh pnpm install pnpm --dir cloudflare-os install ```

### Step A3 — Authenticate Wrangler

```sh pnpm exec wrangler login ```

### Step A4 — Read the current sources first (they may have changed since this plan)

Before editing anything, read the checkout's README.md, deployment.jsonc, and scripts/deploy.mjs. The upstream is fast-moving (v2, early access) — treat the checkout as truth over this document where they differ.

### Step A5 — Set up Cloudflare Access (default sign-in)

Because we use a custom domain we own (os.acme-studios.org), we can create the Access app and get the AUD BEFORE deploying — no need to deploy first to discover a URL. DNS doesn't need to resolve yet for Access to mint the AUD; Wrangler creates the DNS/TLS record on deploy. 1. In Zero Trust, create a self-hosted Access application with application domain os.acme-studios.org. 2. Note the team issuer (https://<team>.cloudflareaccess.com, no path) and the app's AUD tag → these go straight into deployment.jsonc (access.issuer, access.audience). 3. Attach the Access policy ("Allow Employees" via Authentik once wired; a simple email-domain policy is fine to start) and set your admins email list (who may reach /admin).

> On *.workers.dev (no custom domain) you'd have to deploy first, learn the URL, then create the Access app and redeploy. We avoid that by owning the hostname.

### Worker names (fill into workers.*.name)

| Config key | Suggested name | Role / route |
| --- | --- | --- |
| workshop | acme-os-workshop | main app → customDomain: os.acme-studios.org |
| context | acme-os-context | Context Library gatekeeper |
| customGatekeeper | acme-os-custom-gk | example custom gatekeeper |
| errorReporter | acme-os-error-reporter | private error reporter |

Names are permanent service identities — keep them unique in the account and don't rename later.

### Step A6 — Fill deployment.jsonc (minimal eval config)

```jsonc { "accountId": "<YOUR_32_CHAR_ACCOUNT_ID>", "workers": { "workshop":        { "name": "acme-os-workshop", "route": { "customDomain": "os.acme-studios.org" } }, "context":         { "name": "acme-os-context" }, "customGatekeeper":{ "name": "acme-os-custom-gk" }, "errorReporter":   { "name": "acme-os-error-reporter" } }, "access": { "issuer":   "https://<team>.cloudflareaccess.com", "audience": "<ACCESS_AUD_TAG>",   // available now: create the self-hosted app on os.acme-studios.org first "admins":   ["<you@acme-studios.org or your login email>"] }, "aiGateway": { "enabled": true, "name": "default", "accountId": "<YOUR_ACCOUNT_ID>", "providers": ["anthropic", "openai", "google", "cloudflare"], "workersAi": { "mode": "gateway", "gateway": "default" } }, "context": { "sharingDomain": "production", "kvNamespaceId": null }, "resources": { "blueprintsKvNamespaceId": null, "avatarsKvNamespaceId": null, "blueprintContentBucket": null }, "observability": { "logs": true } } ``` Notes:

- null resources = Wrangler auto-provisions them (named with the worker prefix) and reconnects on future deploys. Only set explicit IDs to adopt existing data.
- Keep the four worker names unique — they're service-binding identities.

### Step A7 — Create & install the AI Gateway token (the model-routing goal)

1. Create an AI Gateway named default in your account (or let Cloudflare create it on first use). 2. Create a narrowly-scoped API token: AI Gateway – Read, AI Gateway – Edit, Workers AI – Read. 3. Configure provider auth in AI Gateway: Unified Billing (simplest) or BYOK (paste your own Anthropic/OpenAI/Google keys). 4. Install the secret against the workshop worker: ```sh pnpm exec wrangler secret put CF_AI_GATEWAY_API_TOKEN --name myco-os-workshop ``` > Result: every model request routes through your AI Gateway → unified logs, caching, rate limits, cost accounting, and central key management.

### Secrets & config vars — what's secret vs. what's a plain var (confirmed from scripts/deploy.mjs)

| Value | Type | Where it lives | When |
| --- | --- | --- | --- |
| CF_AI_GATEWAY_API_TOKEN | secret | .dev.vars (local run-local) / wrangler secret put (prod) | now — mint the AI Gateway token first |
| CF_AI_GATEWAY (name), CF_AI_GATEWAY_ACCOUNT_ID, CF_AI_GATEWAY_PROVIDERS | plain var | auto-set from deployment.jsonc aiGateway.* | at deploy |
| CF_ACCESS_ISS, CF_ACCESS_AUD | plain var | auto-set from deployment.jsonc access.* | at deploy (AUD available now via custom domain) |
| Authentik client ID/secret | secret | inside Cloudflare Access (the Generic OIDC IdP), not in the repo or Worker | at IdP setup |

Local development (pnpm run-local on the kernel): put CF_AI_GATEWAY_API_TOKEN=... in a .dev.vars file (gitignored — never commit). The AI coding agent should ask you for this token when it needs to run/test AI locally, and for any future gatekeeper secrets the same way — .dev.vars for local, wrangler secret put for prod. The only value that must wait for deploy is nothing on the secret side; the Access AUD is a var and you already have it from Step A5.

> Rule for the agent: ask for a secret only when the sprint actually needs it; never invent, hardcode, or log it; never commit .dev.vars.

### Step A8 — Validate, then deploy

```sh pnpm check      # validates config + generates temp Wrangler files pnpm deploy     # deploys Error Reporter + Gatekeepers, then Workshop; cleans generated files ``` The deploy script builds the frontend in Access mode and deploys the supporting Workers before the Workshop.

### Step A9 — First-run smoke test

- Sign in via Access at your workers.dev URL.
- Visit /admin (must be an email in admins).
- Verify: AI works (ask the agent something → confirm a request appears in AI Gateway logs), a Gadget can be created, and a Context collection can be authored.

✅ Phase A exit criteria: you can sign in, the agent responds, and model traffic shows up in your AI Gateway.

## 3. Phase B — Production hardening & full customization

### B1 — Branding / UI visuals (Admin UI, no redeploy)

In /admin → General: set site name, upload logo (square PNG/JPEG/WebP/SVG ≤5 MB), set accent color. Applies on each user's next connection. This is your fastest "make it *Nikhil/MyCo* OS" win.

### B2 — Agent instructions & announcements (Admin UI)

- Set deployment-level agent instructions (org tone, escalation rules, do/don't, company-specific defaults).
- Configure announcement banners, featured blueprints, signup behavior, and output formats.

### B3 — Context Library (company knowledge / "skills"-as-context)

- Create public collections (admin-only authoring, readable by all) for how your org operates — playbooks, product facts, voice guides, runbooks. Agents read these as observations.
- If you want Git-backed collections, enable Artifacts in deployment.jsonc:

```jsonc "context": { "sharingDomain": "production", "kvNamespaceId": null, "artifacts": { "enabled": true, "namespace": "myco-context-collections" } } ``` Requires Artifacts on the account; keep the namespace stable (existing collections reference it).

> On "skills": the deployed OS drives agent behavior primarily through Context collections + admin agent instructions + output-format blueprints, not a per-user SKILL.md loader like this Seal workspace. The .agents/skills/* in the repos (write-gatekeeper, cloudflare-os-operator) are build/operator skills for people working on the repo, not runtime user skills. To give end users reusable capabilities, publish Blueprints (app templates) and Context collections. Track this if upstream later adds a runtime skill mechanism.

### B4 — Connect MCP servers (your internal tools)

Two supported paths (see briefing §7):

- Self-serve: enable the gatekeeper-mcp connector so users paste MCP endpoint URLs (Jira, Confluence, Salesforce, etc.); grant per-server or per-tool.
- Org portal: if you run a Cloudflare MCP Server Portal, configure gatekeeper-mcp-portal with one portal URL so everyone reaches org-approved servers through Access + Gateway.
- Manage which connectors are offered and their auto-provisioning mode (disabled/optional/enabled) in /admin.

### B5 — Custom gatekeeper (only if a connector doesn't exist)

Add under packages/ in the starter repo (outside the submodule). The starter binds the example as GATEKEEPER_CUSTOM. Minimal flow: types.d.ts → getDeploymentInfo() (authorize observation) → CustomGatekeeper (create session) → CustomAccount (singleton) → GatekeeperVendor (advertise auto-provision) → Workshop service binding. Follow the upstream write-gatekeeper skill; design the API first and pause for review before adding OAuth/writes/simulation.

### B6 — Custom domain (production routing)

1. Ensure the hostname is in an active Cloudflare zone you own and has no conflicting CNAME. 2. Update deployment.jsonc: ```jsonc "workers": { "workshop": { "name": "myco-os-workshop", "route": { "customDomain": "os.myco.com" } } } ``` 3. Update the Access application to cover the new hostname (issuer/AUD may change). Redeploy (pnpm check && pnpm deploy). Wrangler creates the DNS record + certificate.

### B7 — Observability & error reporting

Tune in deployment.jsonc: structured logs, invocationLogs, traces, and sampling. Configure the Error Reporter (env + release metadata). Optionally enable frontend error reporting (build flag). Verify the Error Reporter query surface post-deploy.

### B7.5 — Authentik (Generic OIDC) + Cloudflare Access + MCP Portal

This is the recommended auth architecture for acme-os. Direction of OIDC: Authentik is the OIDC Identity Provider; Cloudflare Access is the OIDC client (relying party). acme-os sits behind Access as a self-hosted app and trusts the signed Access JWT — it does not implement generic OIDC itself. (Ref: Generic OIDC IdP.)

> ⚠️ Register acme-os as a Self-hosted application in Access — not a "SaaS / OIDC" application. SaaS-OIDC is the reverse case where Access acts as IdP to a downstream app.

Step 1 — Create the OIDC client in Authentik

- Create an OAuth2/OpenID Provider + Application in Authentik.
- Authorized redirect URI: https://<your-team-name>.cloudflareaccess.com/cdn-cgi/access/callback
- From Authentik's OIDC discovery / well-known endpoint, capture: Client ID, Client Secret, Auth URL (authorization_endpoint), Token URL (token_endpoint), Certificate URL (jwks_uri).

Step 2 — Add Authentik as a Generic OIDC identity provider in Access

- Zero Trust → Integrations → Identity providers → Add new → OpenID Connect.
- Paste Client ID / Secret / Auth URL / Token URL / Certificate URL.
- Scopes: ["openid", "email", "profile"]. To pull group membership later, add the groups claim and matching scope:

```jsonc "scopes": ["openid", "email", "profile"], "claims": ["groups"]        // TBD — see Step 5 ```

- Enable Proof Key for Code Exchange (PKCE) if Authentik requires it. Test the connection.

Step 3 — Put acme-os behind Access (self-hosted app)

- Access → Applications → Add → Self-hosted, hostname = your Workshop hostname (e.g. os.acme.com, or the *.workers.dev URL for eval).
- Identity provider = the Authentik Generic OIDC connector.
- Policy: "Allow Employees" (e.g. emails ending in @acme.com, or an Authentik group once wired).
- Copy the app's AUD tag and the team issuer (https://<team>.cloudflareaccess.com) into deployment.jsonc (access.audience, access.issuer). Set access.admins to the email addresses of in-app admins.

Step 4 — MCP servers + Server Portal under the same IdP

- Front your MCP Server Portal with its own Access self-hosted app, same Authentik IdP.
- Add per-server Access policies to control who reaches which servers (this is where group-based tool scoping lives — see Step 5).
- In acme-os, enable gatekeeper-mcp-portal and point it at the single portal URL (admin-configured). Access decides connection eligibility; AI Gateway logs the traffic. For self-serve, enable gatekeeper-mcp so users paste individual endpoint URLs.

Step 5 — Group-based access (TBD — documented, not yet implemented)

- Generic OIDC supports pulling Authentik groups as a custom claim and SCIM 2.0 group sync (with deprovisioning so removing a user in Authentik ends their Access sessions).
- Intended model once configured:
- Access layer (group-aware): which people reach acme-os, and which MCP servers / portal targets each group can reach → Authentik groups → Access policies. *(This is where per-user/per-group tool access actually enforces.)*
- acme-os layer (email-based today): the admins list is by email; connector availability + auto-provisioning policy + public/private Context collections are set in /admin. The backend keys users by verified email only and does not read groups from the JWT (confirmed in packages/workshop-backend/src/access.ts) — so there is no automatic "Authentik group → context collection" mapping today. Gate group-specific tools/context at the Access/portal layer.
- Decision deferred: exact group→policy mapping (e.g. mcp-admins → Salesforce MCP) is TBD. Revisit if upstream later adds group-claim awareness inside the Workshop.

### B8 — Sign-in tuning (optional)

Access mode is recommended and default. Only if you need provider sign-in ("Continue with Google/GitHub") or built-in passwords, plan deploy-script changes (AUTH_GATEKEEPERS allowlist, DISABLE_PASSWORD_AUTH) and review upstream backend/frontend docs — the wrapper's validation assumes Access mode. Keep the admins list narrow.

### B9 — Optional per-user AI billing

If you want teams to fund their own model usage, set ENABLE_CLOUDFLARE_LIMITS=true (+ Cloudflare gatekeeper OAuth app + AUTH_GATEKEEPERS=cloudflare). Users get a free daily allowance on your gateway, then bill to their own connected Cloudflare account's default gateway. Leave unset for unlimited (platform-funded).

✅ Phase B exit criteria: custom domain live behind Access, branding applied, public context collections seeded, at least one MCP/connector wired, model traffic in your AI Gateway, observability verified.

## 3b. Phase C — Custom features: identity-aware AI governance (acme-os)

These are net-new features we build on top of upstream — the real "customization" beyond config. Track them in the acme-os repo (see repo strategy below). All three depend on the groups claim flowing Authentik → Access → JWT (the B7.5 TBD).

### Repo strategy for acme-os (important — these features live in the kernel)

Features 1 & 2 modify workshop-backend, which is the pinned cloudflare-os submodule — you can't add them in packages/ alone. Recommended structure so upgrades stay sane:

- acme-os = your clone of cloudflare-os-starter (your config, your packages/, your deployment.jsonc).
- acme/cloudflare-os = your fork of the kernel. Put kernel patches on a branch (e.g. acme-identity-aig). Point the starter's submodule at your fork/branch.
- Upgrades: rebase acme-identity-aig onto each upstream tag; the diff stays small and reviewable. Consider proposing Feature 1 upstream (it's generally useful) to shrink your patch set.
- Keep everything that *can* live in packages/ (custom gatekeepers, config-driven policy tables) out of the fork to minimize kernel drift.

### Feature 1 — Attach identity claims to cf-aig-metadata (analytics + spend scoping)

Status: plumbing required (confirmed in source). The gateway header is already sent; the identity just isn't in it yet.

- Where the value is built: packages/workshop-backend/src/ai-models.ts → buildMetadata(initiator, context) currently returns { user: initiator.id } (internal DO id) plus optional source/gadgetId/chatId/automated.
- Where the claims already exist: packages/workshop-backend/src/server.ts verifies the Access JWT (verifyCfAccessJwt) and keeps the full payload as accessPayload, passed into PublicApiImpl. email/sub/groups are all present here once groups is added to the Generic OIDC claim set (B7.5).
- The patch: thread accessPayload (email, a flattened groups, optional username) down to buildMetadata (extend AiChatAuthorInfo/initiator or pass an identity context), and include them in the returned GatewayMetadata. GatewayMetadata is a closed TS type, so extend the type too. AI Gateway itself accepts arbitrary custom keys, so once set they appear in logs/analytics and are usable as Spend Limit dimensions.

⚠️ Hard constraints (from AI Gateway custom-metadata docs) — design around these:

- Max 5 metadata entries per request; only the first 5 are saved. buildMetadata can already emit up to 5 (user, source, gadgetId, chatId, automated). Adding email + username + groups exceeds the cap. Consolidate first — e.g. collapse gadgetId+chatId into a single source string like "gadget:<id>#chat:<n>", and keep automated only when true — to reserve slots for user, email, groups.
- Values must be string / number / boolean — no arrays/objects. Authentik groups is an array → flatten it: pick one of (a) primary/highest-privilege group string, (b) comma-joined string (watch dashboard "contains" matching), or (c) a derived tier string ("frontier"/"standard") computed from groups — (c) is cleanest for Spend Limit rules. Decide this explicitly.
- **cf.* keys are reserved** (Cloudflare strips them). Use plain keys: email, groups/tier, username.
- Prefer a stable, low-cardinality dimension for spend rules (a tier beats raw email for rule count; keep email/username for analytics drill-down).

Why not the "identity-aware AI Gateway" SHIP (cf.user_id via Access-protected gateway domain): that captures identity only for traffic reaching the gateway through Access, and only injects cf.user_id — not groups/email. acme-os calls the gateway server-side with a token, so cf-aig-metadata is the correct, more controllable mechanism. (You *could* also front the gateway with Access later for defense-in-depth, but metadata is what powers the group analytics/spend you want.)

Demo payoff: AI Gateway Analytics filtered/split by email, tier, groups → rich per-user and per-group spend dashboards.

### Feature 2 — Per-group model allowlist (new feature — build it)

Status: no native per-user/per-group model gating in acme-os or AI Gateway; this is genuine new code.

- Where the catalog is produced: packages/workshop-backend/src/ai-gateway.ts → getModelList() (and the getModel()/resolution path). Today the catalog from deployment.jsonc providers is identical for everyone.
- The build: define a policy table (group/tier → allowed model ids, ideally config-driven so it lives in packages//deployment.jsonc, not the fork), then in the kernel: (a) filter getModelList() by the caller's groups/tier so users only *see* permitted models, and (b) enforce at getModel()/request time so a crafted request can't select a disallowed model (reject with a clear error). Enforce server-side using accessPayload.groups — never trust a client-sent model id alone.
- Example policy: admins → 4–5 frontier models; employees → 2 frontier + selected Workers AI; everyone → base Workers AI.
- Interaction with Feature 3: allowlist controls *which models a group may call*; Spend Limits control *how much a group may spend*. Use both together.

### Feature 3 — Per-group spend limits via AI Gateway Spend Limits (native — configure, don't build)

Status: natively supported (AI Gateway Spend Limits, GA 2026-06). No enforcement code needed — it keys off Feature 1's metadata.

- Mechanism: Spend Limits set dollar budgets over fixed/sliding windows, scoped by model, provider, or custom metadata dimensions. Evaluated before the upstream call; over-budget → 429 (or fall back to a cheaper model via a Dynamic Route — e.g. primary anthropic/claude-opus-* → fallback @cf/…). Max 20 rules per gateway. Cost is best-effort (token×pricing), eventually consistent (bursts can slightly overshoot). Works with Unified Billing and BYOK.
- How to configure (dashboard or API), keyed off Feature 1 metadata:
- Global guardrail: cap total gateway spend (e.g. $10,000/day).
- Per-tier: metadata.tier = frontier → higher budget; metadata.tier = standard → lower budget.
- Per-user: metadata.email scoped rule (e.g. $X/day/user) — use sparingly given the 20-rule cap; prefer tier-level.
- Per-model-per-tier: e.g. an expensive frontier model capped $50/day for standard, with a Dynamic Route fallback to a cheaper model instead of a hard block.
- Design note: the 20-rule cap + metadata-value constraints are why a derived tier string (Feature 1) is the recommended primary spend dimension; keep email for analytics and a few targeted per-user rules.

### Phase C build order

1. B7.5 first — get groups into the JWT (nothing group-based works without it). 2. Feature 1 (metadata plumbing) — decide the flatten/tier strategy and the 5-entry budget; verify claims show in AI Gateway logs. 3. Feature 3 (Spend Limits) — configure tier/global rules against the new metadata; verify 429/fallback behavior. 4. Feature 2 (model allowlist) — policy table + list-filter + request-time enforcement; verify a standard user can't call a frontier-only model.

✅ Phase C exit criteria: AI Gateway analytics split by user + group/tier; spend limits enforce per tier (and global); model access differs by group with server-side enforcement; all kernel changes isolated on a rebasable fork branch referenced by the acme-os submodule.

## 4. Verification checklist (run after every deploy)

- [ ] Access sign-in works; unauthenticated requests are blocked.
- [ ] /admin reachable only by admins; runtime settings persist.
- [ ] Agent responds; AI Gateway logs show the traffic (routing confirmed).
- [ ] A Gadget can be created, run (sandboxed), and shared as a Blueprint.
- [ ] Context collections readable by users; public ones auto-enabled.
- [ ] Connected gatekeepers/MCPs: read = observation, write = queued approval.
- [ ] Storage (KV/R2) provisioned and reconnected on redeploy.
- [ ] Error Reporter receiving structured errors.
- [ ] Custom domain (Phase B) resolves with valid cert.

## 5. Upgrade & rollback runbook (pinned submodule)

1. Record the current cloudflare-os gitlink (for rollback). 2. Bump the submodule to the intended upstream commit (never blindly). 3. Review Workshop/Context Wrangler base-config changes and gatekeeper contract changes surfaced by the deploy script. 4. pnpm install + pnpm --dir cloudflare-os install + pnpm check. 5. Deploy & verify (§4 checklist): Access, admin, storage, AI, context, custom gatekeepers, error reporter. 6. Rollback if needed: restore the previous gitlink and redeploy, or use Workers rollback when bindings are compatible.

## 6. Risks & watch-items

- Early-access churn: v2 is a full rewrite; APIs/config may shift. Pin releases, read the checkout before each change, upgrade deliberately.
- Account entitlements: Dynamic Worker Loaders, Browser Rendering, Artifacts, and AI Gateway provider auth are easy to miss — verify up front.
- Access misconfig = lockout or open door: get issuer/AUD/admins right; the admins list is your only /admin gate.
- Secrets hygiene: never put secrets in deployment.jsonc; use wrangler secret put. Never log prompts/tokens.
- AI cost: routing everything through your gateway centralizes cost — set rate limits/caching in AI Gateway; consider ENABLE_CLOUDFLARE_LIMITS for team-level funding.
- Don't fork upstream: keep customizations in the starter's config + packages/. Patch the submodule only when a Worker boundary truly can't express the behavior, and keep it as a reviewable commit/fork.

## 7. Suggested execution order (copy-paste checklist)

1. Confirm account entitlements + account ID. 2. Clone starter + git submodule update --init. 3. pnpm install (×2) + wrangler login. 4. Create Access app (or defer hostname to after first deploy) → capture issuer/AUD/admins. 5. Create AI Gateway default + token + provider auth. 6. Fill deployment.jsonc (eval config, §A6). 7. wrangler secret put CF_AI_GATEWAY_API_TOKEN. 8. pnpm check → pnpm deploy → smoke test (§A9). 9. Branding + agent instructions + context collections in /admin. 10. Wire MCPs/connectors; add custom gatekeeper if needed. 11. Custom domain + update Access + redeploy. 12. Tune observability; run full verification (§4). 13. Document your config; establish upgrade cadence (§5).

*Next step when you're ready: I can execute Phase A in the sandbox — the repos are already cloned at /workspace/cloudflare-os-starter. I'd need your target account ID, Access team issuer + AUD, and confirmation of which providers to route through AI Gateway. Deploys touch your real account, so I'll confirm before running anything that provisions or deploys.*
