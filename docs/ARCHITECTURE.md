# WhatsFlow Architecture (Proposal, v0.1)

Status: proposal for review. No application code exists yet.
"WhatsFlow" is a working name. All branding is read from one config module (see section 9).

## 1. Repository inspection (2026-10-01)

| Item | Finding |
|---|---|
| Existing code | None. Only `README.md` containing a title. |
| Existing framework | None, so there is no stack to preserve. |
| Toolchain available in dev container | Node 22.22, npm 10.9, Docker 29.6, PostgreSQL 16 client/server, Redis 7.0 |
| Branches | `main` (initial commit), `claude/wizardly-rubin-d37kv6` (working branch) |

Conclusion: greenfield project. We adopt the preferred stack from the brief.

## 2. Stack decisions

| Concern | Choice | Reason |
|---|---|---|
| Web app + API | Next.js (App Router) + TypeScript strict | One deployable for UI, route handlers, server actions |
| UI | Tailwind CSS + shadcn/ui + lucide icons | Restrained, accessible, owned component code |
| DB | PostgreSQL 16 | Relational integrity, JSONB for custom fields and workflow definitions |
| ORM | Prisma | Typed queries, migrations, parameterized SQL |
| Auth | Auth.js (NextAuth v5) Credentials provider, database sessions | Supports adding Google/Microsoft/SSO later |
| Password hashing | argon2id (`@node-rs/argon2`) | Current OWASP recommendation |
| Queue | Redis + BullMQ | Retries, backoff, delayed jobs (scheduling), rate limiter, job IDs for idempotency |
| Workers | Separate Node process (`worker/`) sharing the same `src/server` code | Long-running jobs never run inside HTTP requests |
| Object storage | S3-compatible (MinIO in dev) via AWS SDK v3, presigned URLs | Media access control |
| Payments | `BillingProvider` interface, Stripe implementation | Provider can be swapped |
| Email | `EmailProvider` interface; SMTP (Mailpit in dev) | Verification, password reset, invites |
| Validation | Zod | Shared schemas for forms, API, env |
| Logging | pino (JSON) with request/correlation IDs | Structured, cheap |
| Tests | Vitest (unit + integration against real Postgres), Playwright (E2E) | |
| Lint/format | ESLint (next + typescript-eslint strict) + Prettier | |
| Deploy | Docker images: `web` and `worker`; docker compose for local deps | |

Monorepo tooling (Turborepo/pnpm workspaces) is deliberately not used in V1. A single package with `src/` for web and `worker/` for the worker entrypoint keeps setup simple. It can be split later.

## 3. High-level components

```
                 +-------------------+          +-------------------+
 Browser  -----> |  Next.js (web)    |  ----->  |  PostgreSQL       |
 API clients --> |  - UI (RSC)       |          +-------------------+
 Meta webhooks ->|  - /api/v1/* REST |  ----->  +-------------------+
 Stripe hooks -->|  - /api/webhooks/*|          |  Redis (BullMQ)   |
                 +-------------------+          +---------+---------+
                                                          |
                 +-------------------+                    |
                 |  Worker process   | <------------------+
                 |  - send-message   |  ----->  Meta Graph API (WhatsApp Cloud API)
                 |  - campaign-*     |  ----->  Customer webhook URLs
                 |  - webhook-ingest |  ----->  S3 (media)
                 |  - automation     |  ----->  Email provider
                 |  - outbound-hooks |
                 +-------------------+
```

## 4. Source layout (planned)

```
src/
  app/
    (auth)/            login, signup, forgot/reset password, verify email
    (onboarding)/      onboarding wizard
    (app)/[workspace]/ tenant app: dashboard, inbox, contacts, campaigns, ...
    (admin)/admin/     internal admin, separate layout and guard
    api/
      auth/[...nextauth]
      v1/              public REST API (API-key auth)
      webhooks/meta    Meta webhook (GET verify, POST events)
      webhooks/stripe
  components/          ui/ (shadcn), app-specific components
  config/
    brand.ts           product name, logo, domain, support email, company, socials
    plans.ts           plan definitions and limits
    env.ts             Zod-validated environment
  server/
    auth/              Auth.js config, session helpers, password hashing
    authz/             permissions matrix, requirePermission()
    db/                Prisma client, tenant-scoped data access helpers
    services/          domain services (contacts, campaigns, inbox, ...)
    providers/
      whatsapp/        WhatsAppProvider interface + MetaCloudProvider
      billing/         BillingProvider interface + StripeProvider
      email/           EmailProvider interface + SmtpProvider
      storage/         StorageProvider interface + S3Provider
    queue/             queue definitions, job payload types
    crypto/            envelope encryption for secrets
    audit/             audit log writer
    logging/           pino logger, request context
  lib/                 pure utilities (phone normalization, template vars, csv)
worker/
  index.ts             starts BullMQ workers
prisma/
  schema.prisma, migrations/, seed.ts
tests/
  unit/, integration/, e2e/
```

## 5. Multi-tenancy and authorization

- Shared database, shared schema. Every tenant-owned table has a non-null `workspaceId` and composite indexes leading with `workspaceId`.
- Workspace is resolved server-side from the URL slug plus the session user's `WorkspaceMember` row, or from the API key. The client never supplies a trusted `workspaceId`.
- All tenant data access goes through a `TenantContext` (`{ workspaceId, actor, permissions }`). Service functions take the context as the first argument and always include `workspaceId` in `where` clauses. Lookups by id use `findFirst({ where: { id, workspaceId } })`, never `findUnique({ id })` alone.
- A Prisma client extension will additionally reject queries on tenant models that lack a `workspaceId` filter (defense in depth). Tests assert cross-tenant access returns 404.
- Optional later hardening: PostgreSQL Row Level Security keyed on a session variable. Not in V1 because it complicates Prisma connection pooling; the decision is documented, not ignored.

### Permissions

Roles map to permission sets in one file (`server/authz/permissions.ts`). UI and server both use `can(ctx, "campaign:send")`; only the server check is authoritative.

| Permission group | OWNER | ADMIN | AGENT | ANALYST |
|---|---|---|---|---|
| inbox read/reply/assign | yes | yes | yes | read only |
| contacts read/write | yes | yes | yes | read only |
| contacts delete/import/export | yes | yes | no | export only |
| templates manage | yes | yes | no | no |
| campaigns create/send | yes | yes | no | no |
| analytics/reports | yes | yes | no | yes |
| automations manage | yes | yes | no | no |
| team invite/remove/role | yes | yes (not OWNER role) | no | no |
| WhatsApp connection | yes | yes | no | no |
| API keys and webhooks | yes | yes | no | no |
| billing, ownership transfer, workspace delete | yes | no | no | no |

## 6. WhatsApp integration

All Meta calls go through `WhatsAppProvider` (interface) implemented by `MetaCloudProvider`:

```
connectAccount, getPhoneNumberStatus, sendTextMessage, sendTemplateMessage,
sendMediaMessage, uploadMedia, downloadMedia, listTemplates, getTemplate,
createTemplate, deleteTemplate, verifyWebhookSignature, parseWebhook
```

`parseWebhook` turns a raw Meta payload into provider-neutral events (`InboundMessage`, `MessageStatusUpdate`, `TemplateStatusUpdate`, `AccountUpdate`). The rest of the app only sees these neutral types, which is what allows other channels later.

Credentials: access tokens are stored encrypted (AES-256-GCM, key from `ENCRYPTION_KEY`, key id stored with ciphertext to allow rotation) in a `Credential` table referenced by `WhatsAppAccount.accessTokenRef`. They are decrypted only inside the worker/provider and never serialized to the client.

Connection flow in V1: manual entry of WABA ID, phone number ID and a system-user access token, followed by a verification call. Meta Embedded Signup is a later improvement because it requires Meta app review and Tech Provider setup that we cannot test here.

Every Meta API detail used is listed in `docs/META_API_VERIFICATION.md` and must be confirmed against official docs before Phase 3 code is considered done.

### Customer service window

The provider-neutral rule: free-form (non-template) outbound messages are allowed only within the window opened by the contact's last inbound message (Meta documents this as 24 hours; to be verified). The server computes `conversation.windowExpiresAt` from the last inbound message and the composer API refuses free-form sends outside it with a clear error that points the user to approved templates. Meta remains the final authority; a Meta rejection is surfaced, not retried.

## 7. Messaging pipeline and idempotency

1. A send request (inbox, API, campaign, automation) creates a `Message` row with status `QUEUED` and a unique `idempotencyKey` (campaign: `campaignId:contactId`; API: client-supplied `Idempotency-Key` header or generated).
2. A BullMQ job is enqueued with `jobId = message.id`, so enqueuing twice is a no-op.
3. The worker locks the row (`UPDATE ... WHERE id = ? AND status = 'QUEUED' AND providerAttemptId IS NULL`) before calling Meta. If the row already has a `whatsappMessageId`, the job exits without sending. This is what prevents duplicate sends on retry.
4. Ambiguous failures (timeout after request sent) are marked `UNKNOWN_SEND_STATE` internally and not blindly retried; they reconcile when a status webhook arrives or are marked failed after a timeout. This trades a small risk of a missed message for never sending duplicates, as the brief requires.
5. Retryable errors (network before send, 429, 5xx) retry with exponential backoff; permanent errors (invalid number, template not approved, opted out) fail immediately with a mapped user-facing message and the raw error kept internally.
6. Per phone-number rate limiting via BullMQ group/limiter keyed on `whatsappAccountId`. Concrete throughput numbers come from Meta's limits (to be verified) and the account's stored messaging tier.
7. Every status transition is appended to `MessageEvent` (immutable). `Message` holds denormalized current status and timestamps. Status only moves forward (QUEUED < SENT < DELIVERED < READ; FAILED terminal) so out-of-order webhooks cannot regress it.

## 8. Webhooks

Inbound (Meta): `GET /api/webhooks/meta` handles the verification handshake; `POST` verifies `X-Hub-Signature-256` against the raw body with the app secret, stores the raw payload in `WebhookEvent` with a dedupe key (provider + message id + status, or a body hash), returns 200 quickly, and enqueues processing. Processing is idempotent through the unique dedupe key and forward-only status rules.

Outbound (customer): `WebhookEndpoint` rows per workspace with a generated secret. Deliveries are signed (`X-WhatsFlow-Signature: t=<ts>,v1=<hmac-sha256>`), retried with backoff, and logged in `WebhookDelivery` for the UI.

## 9. Configuration

- `src/config/brand.ts`: product name, logo path, domain, support email, company name, social links. Overridable through `NEXT_PUBLIC_BRAND_*` env vars.
- `src/config/plans.ts`: plan ids, limits, feature flags. Prices live in the billing provider (Stripe price ids in env), not in code.
- `src/config/env.ts`: Zod schema; the app fails fast on missing or invalid env.

## 10. Security baseline

argon2id hashing; database sessions with httpOnly, secure, sameSite=lax cookies; Auth.js CSRF for auth routes and origin checks on mutating server actions/route handlers; Zod validation at every boundary; Redis-backed rate limiting on auth, API and webhook routes; security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy) in middleware; API keys stored as SHA-256 hashes with a visible prefix; secrets encrypted at rest; media served only through short-lived presigned URLs after an authorization check; audit log table written by services, never by the client; admin area guarded by a separate `isPlatformAdmin` flag and message bodies redacted by default.

## 11. Observability

pino JSON logs with `requestId` (from header or generated in middleware) and `jobId`/`messageId`/`campaignId` bindings in workers. `ProviderApiLog` stores Meta request metadata, status code and error body (no tokens) linked to `messageId`, which gives the debug chain Campaign -> CampaignRecipient -> Message -> ProviderApiLog -> WebhookEvent/MessageEvent.

## 12. External dependencies

| Dependency | Used for | Needed from phase |
|---|---|---|
| Meta WhatsApp Cloud API (Graph API) | Sending, templates, phone status, media | 3 |
| Meta webhooks | Inbound messages, statuses, template updates | 3 |
| Stripe | Subscription billing | 9 |
| S3-compatible storage | Media, CSV import files, exports | 2 (CSV), 4 (media) |
| SMTP / email provider | Verification, reset, invites, notifications | 1 |
| Redis | Queues, rate limiting | 1 (rate limit), 5 (queues) |

## 13. Data stored and why (privacy summary)

Detailed in `docs/PRIVACY.md` (Phase 10). Summary: account data (to authenticate), contact data supplied by the customer (to message their customers), message content and media (to show the inbox), delivery events (analytics), audit logs (security). Workspace deletion performs a hard delete of tenant rows and media after a grace period; contact deletion removes the contact and its PII from messages.
