# acme-os — Coding Guidelines (AI Agent Context)

## Notes

You are building acme-os, a customized fork of Cloudflare OS. Read this fully before writing code. The cloned repository is the source of truth — if these guidelines and the actual code disagree, follow the code and flag the mismatch.

## 0. Stack reality (do NOT assume a generic web stack)

- Language: TypeScript everywhere. Node 24, pnpm 11 (packageManager is pinned — use it, do not switch to npm/yarn).
- Runtime: Cloudflare Workers / workerd. Not Node servers, not Astro, not Next.js.
- Core primitives: Durable Objects, Dynamic Workers, Facets, Cap'n Web RPC (capnweb) for all client↔server and worker↔worker calls.
- Frontend: React + Vite + Kumo UI + Phosphor icons + Monaco + Yjs. Not Tailwind, not Astro. Match existing components.
- LLM access: the Pi library (pi-ai / pi-agent-core) — never call provider SDKs directly.
- Tests: vitest (workshop-backend has unit + integration configs) plus node --test scripts.
- Lint/format/typecheck: the repo's vp toolchain (vp lint, vp lint --fix). Typecheck runs via the build (tsc). There is no separate Prettier/ESLint/Tailwind config — do not add one.

## 1. Repo & change discipline (most important rule)

- Two repos: acme-os (fork of cloudflare-os-starter) holds config + packages/ + deployment.jsonc. acme/cloudflare-os (fork of the kernel) is pinned as a git submodule.
- Prefer packages/ in acme-os over editing the kernel. Only patch the kernel submodule when a Worker boundary genuinely cannot express the behavior (Features 1 & 2).
- All kernel patches live on one rebasable branch (acme-main) as small, isolated, well-labeled commits so they survive upstream rebases. Never scatter unrelated edits through kernel files.
- Never edit the submodule from inside acme-os's checkout as if it were vendored — commit kernel changes in the fork, then bump the submodule pointer.
- Secrets are never valid values in deployment.jsonc or code — install via wrangler secret put.

## 2. Security model (this platform is security-first — respect it)

- Capability-based, not ACL: every agent and Gadget starts with access to nothing. Do not broaden ambient/auto-injected access to make something convenient. A gatekeeper must never assert its own ambience.
- Observations vs actions: read-only calls are observations; anything side-effecting must go through the approval/queue path. Do not bypass it.
- Never hardcode secrets/tokens/keys. Read from env/secret store. Never log secrets, prompts, tokens, or full JWTs.
- Validate all external input; assume it is hostile. Enforce authorization server-side using verified claims — never trust a client-sent value (e.g. a model id or group) alone.
- Least privilege for tokens, bindings, and Access policies. Do not weaken auth, TLS, or CORS to "make it work" — if a boundary is in the way, call it out explicitly instead of loosening it.

## 3. AI Gateway metadata constraints (hard limits — design around them)

When attaching identity to cf-aig-metadata:

- Max 5 entries per request — only the first 5 are saved. Consolidate existing keys before adding identity.
- Values must be string / number / boolean — no arrays/objects. Flatten groups (prefer a derived low-cardinality tier string).
- **cf.* keys are reserved** and stripped by Cloudflare — use plain keys (email, tier, username).

## 4. TypeScript & style

- Type every export and public function signature. Use interfaces/types for structured objects.
- Never use any. Use unknown + narrowing, generics, or precise types. Avoid unsafe casts (as) except at verified boundaries.
- Small, single-responsibility functions; descriptive names; clarity over cleverness.
- Comments explain why, not what. No emojis in code or comments.
- Follow existing file/module patterns and error-handling conventions already in the package you're editing. Consistent, meaningful errors and structured logging (@gadgets/backend-utils/logger).

## 5. Testing (non-negotiable — this is how we trust each phase)

- Add/update tests alongside every behavior change: happy path plus key failure and edge cases. For this project specifically, that means: the 5-entry metadata cap, groups→tier flattening, and per-group allow/deny in the model policy — test the deny paths, not just allow.
- Tests must be deterministic and fast. Prefer unit tests; reserve integration/e2e for real boundaries (the backend integration vitest config).
- Never delete or weaken a test to make the build pass. If a test is genuinely wrong, fix it deliberately and say why in the commit.
- Cover enforcement, not just filtering: a hidden model must also be rejected if requested directly.

## 6. Definition of Done — the quality gate (run before declaring any task complete)

Run at the repo you changed; everything must pass with zero warnings/errors:

Kernel fork (cloudflare-os): ```sh pnpm install pnpm lint:fix        # format + autofix pnpm lint:check      # vp lint (no violations) pnpm build           # tsc typecheck + build must succeed pnpm test            # node --test + vitest (unit + integration) ``` Starter (acme-os): ```sh pnpm install pnpm check           # validates deployment.jsonc + generates wrangler config pnpm test            # scripts + custom-gatekeeper + error-reporter tests ``` Do not commit or open a PR until the gate is green. If something can't pass, stop and report why — do not silence it.

## 7. Git hygiene

- One logical change per commit; imperative messages referencing the sprint (e.g. sprint-3: thread Access claims into cf-aig-metadata).
- Tag the green commit at each sprint boundary so rollback is one command.
- Kernel and starter are separate repos — commit and push them independently, then bump the submodule pointer in acme-os.
