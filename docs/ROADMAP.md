# Implementation Roadmap

Each phase ends with: tests, lint, typecheck, migration check, manual verification where possible, docs update, and a phase report (implemented, files, DB changes, env vars, tests, open issues, next step). A phase does not start while the previous one has unresolved critical errors.

| Phase | Scope                                                                     | Exit criteria                                                                       |
| ----- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1     | Project setup, DB, auth, workspaces, UI shell                             | **Done** (2026-10-01). See [Phase 1 report](phase-reports/PHASE-1.md)               |
| 2     | Contacts, tags, lists, segments, CSV import/export                        | **Done** (2026-10-01). See [Phase 2 report](phase-reports/PHASE-2.md)               |
| 3     | WhatsApp connection, Meta webhook endpoint, credential encryption         | Meta items 1-6, 13 verified; webhook signature + idempotency tests pass             |
| 4     | Templates, inbox, composer, media                                         | Window rule enforced server-side; notes cannot reach send path (test)               |
| 5     | Campaigns, BullMQ queue, scheduling, rate limiting                        | Retry test proves no duplicate send; opted-out contacts excluded from marketing     |
| 6     | Analytics from MessageEvent, CSV report export                            | Failed never counted as delivered (test); metrics reconstructable from events       |
| 7     | Automations (JSON workflow + simple UI)                                   | Triggers/conditions/actions from brief; loop protection                             |
| 8     | Public REST API v1, API keys, customer webhooks, integrations page        | API key scoped to one workspace (test); signed deliveries with retry log            |
| 9     | Team management, invites, billing (Stripe), plan limits, usage            | Plan limits enforced server-side                                                    |
| 10    | Security hardening, admin area, privacy docs, perf/load checks, E2E suite | Acceptance criteria list in brief section 50 passes in Playwright where automatable |

## Phase 1: detailed plan (completed; see the report for deviations)

### 1.1 Project scaffolding

- `create-next-app` (TypeScript, App Router, Tailwind, ESLint, `src/`), strict tsconfig, Prettier, path aliases.
- shadcn/ui init with a neutral palette; add button, input, label, form, card, dropdown-menu, dialog, sheet, sonner (toasts), table, badge, avatar, separator, skeleton, tooltip.
- `src/config/brand.ts`, `src/config/env.ts` (Zod), `src/config/plans.ts` (limits only).
- npm scripts: `dev`, `build`, `start`, `lint`, `format`, `typecheck`, `test`, `test:e2e`, `db:migrate`, `db:seed`, `db:reset`, `db:studio`, `worker`.

### 1.2 Local infrastructure

- `docker-compose.yml`: postgres:16, redis:7, minio (S3), mailpit (SMTP catcher).
- `Dockerfile` (multi-stage, standalone Next output) for `web`; worker image target added in Phase 5.
- `.env.example` with every variable from the brief plus `ENCRYPTION_KEY`, `SMTP_*`, `WHATSAPP_GRAPH_API_VERSION`, `NEXT_PUBLIC_BRAND_*`, `LOG_LEVEL`.

### 1.3 Database

- Prisma schema for Phase 1 models (see `docs/DATABASE.md`): User, Account, Session, VerificationToken, PasswordResetToken, Workspace, WorkspaceMember, WorkspaceInvite, AuditLog.
- Initial migration; `prisma/seed.ts` creating a clearly labeled demo workspace (`isDemo = true`) and demo users. Seed refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`.

### 1.4 Authentication

- Email/password auth with database sessions (own session layer; Auth.js was dropped, see ARCHITECTURE.md 2.1).
- argon2id hashing; signup, login, logout; email verification; forgot/reset password with hashed single-use tokens and expiry.
- `EmailProvider` interface with SMTP implementation (Mailpit in dev).
- Redis-backed rate limiting on login, signup and reset endpoints.
- Audit: `user.login`, `user.signup`, `user.password_reset`.

### 1.5 Workspace architecture

- Create workspace (name, slug, timezone, currency); creator becomes OWNER.
- Workspace switcher; routes under `/w/[slug]/...`.
- `getTenantContext(slug)` server helper: loads membership or throws 404; returns `{ workspaceId, userId, role, permissions }`.
- Permissions matrix + `requirePermission(ctx, perm)`.
- Prisma extension that throws if a tenant model is queried without `workspaceId`.

### 1.6 UI shell

- Authenticated layout: sidebar with the navigation from brief section 41 (later-phase pages render an honest "coming in a later phase" empty state, not fake data), top bar with workspace switcher, user menu, and responsive collapsed sidebar (sheet) for tablet/mobile.
- Onboarding route skeleton with steps 1-2 functional (create workspace, business name); WhatsApp/contacts/template steps are placeholders until Phases 2-4.
- Dashboard page with real counts available in Phase 1 (members) and empty states for the rest.
- Settings > Business (name, logo URL, timezone, currency) with audit log entry on change.

### 1.7 Observability and security baseline

- pino logger, `x-request-id` middleware, consistent `AppError` type with user-safe message + internal detail.
- Security headers in `next.config` / middleware.

### 1.8 Tests

- Vitest unit: password hashing, permissions matrix, env validation, slug generation.
- Vitest integration (real Postgres test DB): signup/login service, reset token single use, tenant isolation (user in A cannot read B: 404), Prisma tenant guard.
- Playwright: signup -> verify email (via Mailpit API) -> create workspace -> see dashboard; login/logout.
- GitHub Actions CI: lint, typecheck, unit + integration tests with Postgres/Redis services, build.

### Phase 1 decisions (approved)

1. npm as package manager.
2. URL scheme `/w/[slug]/...` for tenant routes.
3. Database sessions instead of JWT. Because Auth.js Credentials cannot use database sessions, a small own session layer was built instead (ARCHITECTURE.md 2.1).
4. Email verification is required before connecting WhatsApp or sending (enforced from Phase 3), not before exploring the app.
5. Manual WhatsApp credential entry in V1; Embedded Signup later.
