# acme-os — Build Plan (Sprints)

## Notes

A simple, trackable, git-friendly build plan for an AI coding agent (Devin / Claude). Each sprint has: Goal → Tasks → Quality gate → Commit/tag → Rollback. Do not advance to the next sprint until the current sprint's gate is green and committed.

Companion docs: acme-os-plan.md (the detailed reference plan / architecture), acme-os-coding-guidelines.md (rules you must follow).

## Ground rules (apply to every sprint)

- Work on a branch per sprint; open a PR into main; merge only when the gate passes.
- Quality gate = the exact commands in the guidelines §6 (lint:fix → lint:check → build/typecheck → test on the kernel; check + test on the starter). Zero warnings/errors.
- Tag the green merge commit sprint-N-green so rollback is git checkout sprint-N-green (or revert the submodule pointer).
- Two repos: acme-os (starter fork) and acme/cloudflare-os (kernel fork, pinned as submodule). Kernel edits go in the fork on branch acme-main, then bump the submodule pointer in acme-os.
- Secrets via wrangler secret put only. Deploys touch a real Cloudflare account — get explicit human approval before any pnpm deploy.

## Sprint 0 — Repo setup & green baseline

Goal: Both forks exist, build, and pass the gate unmodified — so the gate is trustworthy before any change. Tasks: 0. Confirm sources (no release tags — these repos version by commit): the deploy repo is a fork of cloudflare/cloudflare-os-starter (latest known good 93f14df); the kernel comes in as a submodule of cloudflare/cloudflare-os. Do not deploy the kernel repo directly. 1. Fork the kernel → vnikhilbuddhavarapu/cloudflare-os; create branch acme-main based on the exact commit the starter pins (read .gitmodules + git ls-files -s cloudflare-os; currently bf7f762d). Do not base it on the kernel's latest HEAD — match the starter's pin so the baseline is coherent. 2. Fork/clone the starter into vnikhilbuddhavarapu/acme-os. Point its cloudflare-os submodule url at your kernel fork and the pinned commit on acme-main. 3. git submodule update --init; pnpm install; pnpm --dir cloudflare-os install. 4. Add CI (GitHub Actions) that runs the full quality gate on PRs for both repos. 5. Add acme-os-coding-guidelines.md to the repo root and reference it from the agent's context. Gate: kernel pnpm lint:check && pnpm build && pnpm test green on pristine code; starter pnpm check* + pnpm test green. (*check may need a minimal deployment.jsonc — use placeholders, it should validate.) Commit/tag: sprint-0: baseline + CI → tag sprint-0-green. Rollback: delete branch; forks are untouched upstream mirrors.

## Sprint 1 — First deploy on the custom domain (os.acme-studios.org)

Goal: acme-os runs end-to-end behind Access with AI routed through your AI Gateway. We go straight to the custom domain (no workers.dev step) because the hostname is owned, so the Access AUD is available before deploy. Tasks: 1. Fill deployment.jsonc (see plan §A6): accountId, worker names (acme-os-workshop/-context/-custom-gk/-error-reporter), workshop.route.customDomain: "os.acme-studios.org", aiGateway (mode gateway + providers), access (issuer/AUD/admins), null resources for auto-provision. 2. Ask the user to create the self-hosted Access app on os.acme-studios.org and provide team issuer + AUD; put them in config. (No deploy needed first.) 3. Ask the user to mint the AI Gateway token; store CF_AI_GATEWAY_API_TOKEN in .dev.vars for local, and wrangler secret put for prod. 4. pnpm check → (human-approved) pnpm deploy (Wrangler creates DNS + TLS for the subdomain) → smoke test: sign in via Access, /admin, agent responds, traffic appears in AI Gateway logs, create a Gadget. Gate: pnpm check green; smoke checklist passes on https://os.acme-studios.org. Commit/tag: sprint-1: deployment config (custom domain) → tag sprint-1-green. Never commit .dev.vars. Rollback: wrangler rollback on acme-os-workshop; revert config commit.

## Sprint 2 — Auth: Authentik (Generic OIDC) + Access + groups claim

Goal: Real IdP login; groups present in the Access JWT (foundation for all group logic). Mostly config, no app code. Tasks: (plan §B7.5) 1. Authentik: OAuth2/OIDC provider + app; redirect https://<team>.cloudflareaccess.com/cdn-cgi/access/callback. 2. Access: add Generic OIDC identity provider (Client ID/Secret + endpoints); add groups to claims + scopes; enable SCIM (deprovision on). 3. Attach "Allow Employees" policy to the acme-os self-hosted app. 4. Verify the JWT carries groups (temporary, redacted debug log of claim keys — never log full token; remove before commit). Gate: login via Authentik works; a test user's groups claim is confirmed present. Kernel gate still green (no code change expected). Commit/tag: sprint-2: authentik oidc + access wiring (docs/config) → tag sprint-2-green. Rollback: revert IdP to previous login method in Access; no code to roll back.

## Sprint 3 — Feature 1: identity claims → cf-aig-metadata (kernel patch)

Goal: AI Gateway analytics identify user + group/tier. This is the core custom feature. Tasks: (plan §Feature 1) 1. In packages/workshop-backend/src/server.ts, carry the verified accessPayload (email, groups, sub) into the request/session context that reaches model calls. 2. In ai-models.ts buildMetadata(): consolidate existing keys to stay ≤5 (e.g. merge gadgetId+chatId into one source string; keep automated only when true), then add email, a derived tier (from groups), and optionally username. Extend the GatewayMetadata type. 3. Add a small pure helper deriveTier(groups): string and a flattenGroups(groups) — keep policy/config-driven where possible. Tests (must add): 5-entry cap never exceeded; groups array → correct tier; no cf.* keys; values are only string/number/bool; anonymous/no-groups fallback. Gate: kernel gate green incl. new unit tests; redeploy eval; confirm email/tier visible in AI Gateway logs. Commit/tag: kernel acme-main: sprint-3: thread Access claims into cf-aig-metadata; bump submodule in acme-os → tag sprint-3-green. Rollback: revert kernel commit + submodule pointer; redeploy.

## Sprint 4 — Feature 3: per-group spend limits (native config)

Goal: Enforced dollar budgets per tier + global cap, keyed off Sprint 3 metadata. No app code. Tasks: (plan §Feature 3) 1. In AI Gateway, add Spend Limit rules: global cap; per-tier budgets; optional per-model-per-tier cap. 2. Add a Dynamic Route fallback (expensive frontier → cheaper model) instead of hard 429 where desired. 3. Keep total rules ≤ 20; prefer tier over per-email rules. Gate: simulate over-budget for a test tier → verify 429/fallback; under-budget unaffected. Document the rule set in the repo (docs/spend-limits.md). Commit/tag: sprint-4: spend limit rules (documented) → tag sprint-4-green. Rollback: disable/delete the Spend Limit rules in AI Gateway; revert docs commit.

## Sprint 5 — Feature 2: per-group model allowlist (kernel patch)

Goal: Different model catalogs per group, enforced server-side. Tasks: (plan §Feature 2) 1. Define a config-driven policy table (tier → allowed model ids) — keep in deployment.jsonc/packages/ if possible, read by the kernel. 2. In ai-gateway.ts: filter getModelList() by caller tier (users see only permitted models) and enforce in getModel()/resolution (reject a disallowed model even if requested directly) using verified groups. Tests (must add): admins see/allow frontier set; employees see/allow reduced set; deny path — a standard user requesting a frontier-only model is rejected; unknown/missing tier → safe default (most restrictive). Gate: kernel gate green incl. deny-path tests; redeploy eval; verify two test users get different catalogs and the deny path returns a clear error. Commit/tag: kernel acme-main: sprint-5: per-group model allowlist; bump submodule → tag sprint-5-green. Rollback: revert kernel commit + submodule pointer; redeploy.

## Sprint 6 — Production hardening

Goal: Real domain, branding, knowledge, MCPs, observability. Tasks: (plan §B1–B7) — note: custom domain os.acme-studios.org is already live from Sprint 1, so this sprint is branding + knowledge + MCPs + observability. 1. /admin: site name, logo, accent color, agent instructions, featured blueprints, output formats. 3. Seed public Context collections (company knowledge); enable Artifacts if using Git-backed storage. 4. Wire MCPs: gatekeeper-mcp and/or gatekeeper-mcp-portal (portal URL); set per-server Access policies. 5. Tune observability (logs/invocationLogs/traces/sampling) + Error Reporter. Gate: full verification checklist (plan §4) passes on the custom domain. Commit/tag: sprint-6: production hardening → tag sprint-6-green. Rollback: revert domain/config commit; wrangler rollback.

## Watching upstream (do this once, now)

These repos have no GitHub Releases/tags — track by commit. To know when Cloudflare ships changes:

- GitHub Watch: on both cloudflare/cloudflare-os and cloudflare-os-starter, use Watch → Custom → Releases + (optionally) Pushes, or just star + check. Since there are no releases, watching commits on the default branch is what matters.
- Compare view for diffs: https://github.com/cloudflare/cloudflare-os/compare/<your-pinned-sha>...main shows exactly what changed since your submodule pin (e.g. bf7f762d...main). Same pattern for the starter.
- Automated: a scheduled job (see below) can poll the default-branch HEAD of both repos and tell you when it moves past your pinned commit, so upgrades (Sprint 7) are deliberate, not surprises.

## Sprint 7 — Upgrade & rollback drill

Goal: Prove you can absorb upstream changes safely. Tasks: (plan §5) 1. Record current submodule gitlink. 2. Rebase acme-main onto the next upstream tag; resolve conflicts in the 3 patched files. 3. pnpm install (×2) + full gate; redeploy eval; run verification. 4. Practice a rollback (restore gitlink / wrangler rollback) and document the runbook in docs/upgrade.md. Gate: gate green on rebased kernel; eval verification passes; rollback verified. Commit/tag: sprint-7: upgrade drill + runbook → tag sprint-7-green. Rollback: restore previous submodule gitlink; redeploy.

## Progress tracker

| Sprint | Focus | Kernel change? | Deploy? | Status |
| --- | --- | --- | --- | --- |
| 0 | Baseline + CI | no | no | ☐ |
| 1 | Eval deploy | no | yes | ☐ |
| 2 | Authentik OIDC + groups | no | redeploy | ☐ |
| 3 | Feature 1: metadata | yes | redeploy | ☐ |
| 4 | Feature 3: spend limits | no | no | ☐ |
| 5 | Feature 2: model allowlist | yes | redeploy | ☐ |
| 6 | Prod hardening | no | yes | ☐ |
| 7 | Upgrade drill | rebase | redeploy | ☐ |
