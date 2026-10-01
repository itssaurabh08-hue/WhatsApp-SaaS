# Phase 1 Report: Project setup, database, authentication, workspaces, UI shell

Date: 2026-10-01

## What was implemented

- **Project:** Next.js 16 (App Router), TypeScript strict (+ `noUncheckedIndexedAccess`), Tailwind CSS 4, shadcn/ui-style components on Radix, ESLint + Prettier.
- **Configuration:** `src/config/brand.ts` (all branding), `src/config/plans.ts` (limits/features, no prices), `src/config/navigation.ts`, `src/config/env.ts` (Zod; validated at server start via `src/instrumentation.ts`).
- **Database:** Prisma 7 schema and first migration: User, OAuthAccount (reserved), Session, EmailVerificationToken, PasswordResetToken, Workspace, WorkspaceMember, WorkspaceInvite, AuditLog. Seed script with clearly labeled demo data and a production guard.
- **Authentication:** signup, login, logout, email verification, forgot/reset password. argon2id hashing; database sessions with HMAC-hashed ids; sliding expiry; single-use, expiring, hashed tokens; reset signs out all sessions; no account enumeration on reset; uniform login error with timing equalization. See ARCHITECTURE.md 2.1 for why Auth.js was not used.
- **Rate limiting:** Redis fixed-window limits on login (per IP and per email), signup, password reset, and verification resend. Fails open with an error log if Redis is down.
- **Workspaces and tenancy:** create workspace (creator becomes OWNER), workspace switcher, `/w/[slug]` routes, `TenantContext` loaded per request (non-members get 404), permission matrix for OWNER/ADMIN/AGENT/ANALYST checked server-side, Prisma tenant guard rejecting unscoped queries on tenant models.
- **Onboarding:** create workspace, business details (name, timezone, currency), then WhatsApp / contacts / templates steps. Those three are honest placeholders that can be skipped; the templates step explains how templates, variables, the reply window and opt-in work.
- **UI shell:** sidebar with the navigation from the brief, filtered by permission; top bar with workspace switcher and user menu; mobile/tablet drawer navigation; email verification banner with resend; demo-data badge. Real pages: Dashboard (setup checklist, workspace summary, recent activity for roles with audit access), Team (member list), Billing (current plan and limits), Settings > Business (editable by OWNER/ADMIN, audited). All other sections show their empty state and state plainly that they are not available yet.
- **Security and observability:** nonce-based CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, HSTS (production), no `x-powered-by`; `x-request-id` correlation id stored on audit records; pino JSON logs with secret redaction; `AppError` keeps user-facing messages separate from internal ones; health endpoint `/api/health`.
- **Audit log:** signup, login, failed login, logout, email verified, password reset requested/completed, workspace created, settings updated (with changed field names).
- **Tooling:** docker-compose (Postgres, Redis, MinIO, Mailpit), multi-stage Dockerfile (standalone output, non-root user, healthcheck), `.env.example`, GitHub Actions CI.

## Files changed

New project. Main areas: `src/app/**` (routes), `src/components/{ui,app}/**`, `src/config/**`, `src/lib/**`, `src/server/**`, `src/proxy.ts`, `src/instrumentation.ts`, `prisma/**`, `tests/**`, `docker-compose.yml`, `docker/postgres/init/`, `Dockerfile`, `.github/workflows/ci.yml`, `docs/**`, `README.md`.

## Database changes

Migration `20261001064706_init` creates the Phase 1 tables listed above, with indexes on `WorkspaceMember(userId)`, `Session(userId)`, `Session(expiresAt)`, `AuditLog(workspaceId, createdAt desc)`, `AuditLog(actorUserId, createdAt desc)`, `WorkspaceInvite(workspaceId, email)`, plus unique constraints on user email, workspace slug, membership pair and token hashes. `prisma migrate diff` reports no drift between schema and migrations.

## Environment variables required

`APP_URL`, `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` (min 32 chars), `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM`. Optional: `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `LOG_LEVEL`, `EMAIL_PROVIDER`, `RATE_LIMIT_DISABLED`, `NEXT_PUBLIC_BRAND_*`. Later-phase variables are listed in `.env.example`.

## Tests performed (all run in the build environment)

| Check                                             | Result                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                    | pass                                                                                                                                                                                                                                                                                                       |
| `npm run typecheck`                               | pass                                                                                                                                                                                                                                                                                                       |
| `npm run format:check`                            | pass                                                                                                                                                                                                                                                                                                       |
| Unit tests (Vitest)                               | 33 pass: password hashing, token hashing, permission matrix, tenant guard, validation, env, plans, timezones                                                                                                                                                                                               |
| Integration tests (Vitest, real Postgres + Redis) | 29 pass: signup, login, sessions (expiry, renewal, hashed ids), email verification (single use, expiry), password reset (single use, session revocation, no enumeration), workspace creation, tenant isolation, DB tenant guard, role permissions, audit entries, rate limiting incl. Redis-down fail-open |
| E2E (Playwright, production build)                | 6 pass: signup → workspace → setup → dashboard → verify email via the real emailed link (no CSP violations), logout/login, password reset via emailed link, cross-tenant access returns 404, security headers, tablet navigation drawer                                                                    |
| `npm run build`                                   | pass                                                                                                                                                                                                                                                                                                       |
| Migrations                                        | applied to dev, test and e2e databases; no drift                                                                                                                                                                                                                                                           |
| Docker image                                      | built and run; `/api/health` ok, `/login` 200                                                                                                                                                                                                                                                              |

Notes on the environment: Docker Hub rate limits and blocked registries meant `docker compose up` itself could not be exercised here (`docker compose config` validates). Postgres 16 and Redis 7 ran natively instead. The Docker image build was verified with a temporary copy of the Dockerfile that mounts the sandbox proxy CA; the committed Dockerfile has no sandbox-specific lines. CI (`.github/workflows/ci.yml`) has not run yet because nothing has been pushed to a PR.

## Remaining issues / known limitations

- Invitations, member removal and role changes: schema and permissions exist, UI and services arrive in Phase 9 (the Team page is read-only).
- Logo upload: Settings accepts an https URL only until S3 media storage lands (Phase 2/4).
- Internal admin area (`isPlatformAdmin`) is modeled but not built (Phase 10).
- Account and workspace deletion are not built yet (Phase 10).
- `style-src` in the CSP allows `'unsafe-inline'` for inline style attributes used by Radix/Sonner; scripts are nonce-locked.
- Rate limiter is a fixed window; adequate for auth endpoints, may be replaced with a sliding window for the public API (Phase 8).
- `npm audit` reports 4 high findings, all inside Prisma 7.10's own dependency tree: `deepmerge-ts` (used for config merging, not reachable from user input) and `mysql2` (MySQL driver, never loaded because this project uses PostgreSQL). npm's only proposed fix is downgrading to Prisma 6.x; re-check when Prisma publishes a patched 7.x/8.x.
- Meta API behavior remains unverified (docs/META_API_VERIFICATION.md); this blocks Phase 3 sign-off, not Phase 2.

## Next recommended step

Phase 2: contacts (E.164 normalization, duplicate prevention), tags, lists, segments with AND/OR conditions, CSV import (upload to S3, mapping, validation, preview, error report download) and CSV export, with cursor pagination and indexes sized for 100k+ contacts.
