# WhatsFlow Architecture (Proposal, v0.1)

Status: Phase 1 implemented (see docs/phase-reports/PHASE-1.md). Sections describing later phases remain proposals.
"WhatsFlow" is a working name. All branding is read from one config module (see section 9).

## 1. Repository inspection (2026-10-01)

| Item                                 | Finding                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Existing code                        | None. Only `README.md` containing a title.                                |
| Existing framework                   | None, so there is no stack to preserve.                                   |
| Toolchain available in dev container | Node 22.22, npm 10.9, Docker 29.6, PostgreSQL 16 client/server, Redis 7.0 |
| Branches                             | `main` (initial commit), `claude/wizardly-rubin-d37kv6` (working branch)  |

Conclusion: greenfield project. We adopt the preferred stack from the brief.

## 2. Stack decisions

| Concern          | Choice                                                               | Reason                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web app + API    | Next.js 16 (App Router) + TypeScript strict                          | One deployable for UI, route handlers, server actions                                                                                                                                                                                      |
| UI               | Tailwind CSS 4 + shadcn/ui (Radix) + lucide icons                    | Restrained, accessible, owned component code. Components were written from shadcn source by hand because the shadcn registry was unreachable from the build environment; `components.json` is present so `npx shadcn add` works elsewhere. |
| DB               | PostgreSQL 16                                                        | Relational integrity, JSONB for custom fields and workflow definitions                                                                                                                                                                     |
| ORM              | Prisma 7 with `@prisma/adapter-pg`                                   | Typed queries, migrations, parameterized SQL. Client is generated into `src/generated/prisma` (git-ignored, generated on `npm install`).                                                                                                   |
| Auth             | Own session layer (database sessions, see 2.1)                       | Auth.js Credentials provider only supports JWT sessions, which conflicts with revocable database sessions                                                                                                                                  |
| Password hashing | argon2id (`@node-rs/argon2`)                                         | Current OWASP recommendation                                                                                                                                                                                                               |
| Queue            | Redis + BullMQ                                                       | Retries, backoff, delayed jobs (scheduling), rate limiter, job IDs for idempotency                                                                                                                                                         |
| Workers          | Separate Node process (`worker/`) sharing the same `src/server` code | Long-running jobs never run inside HTTP requests                                                                                                                                                                                           |
| Object storage   | S3-compatible (MinIO in dev) via AWS SDK v3, presigned URLs          | Media access control                                                                                                                                                                                                                       |
| Payments         | `BillingProvider` interface, Stripe implementation                   | Provider can be swapped                                                                                                                                                                                                                    |
| Email            | `EmailProvider` interface; SMTP (Mailpit in dev)                     | Verification, password reset, invites                                                                                                                                                                                                      |
| Validation       | Zod                                                                  | Shared schemas for forms, API, env                                                                                                                                                                                                         |
| Logging          | pino (JSON) with request/correlation IDs                             | Structured, cheap                                                                                                                                                                                                                          |
| Tests            | Vitest (unit + integration against real Postgres), Playwright (E2E)  |                                                                                                                                                                                                                                            |
| Lint/format      | ESLint (next + typescript-eslint strict) + Prettier                  |                                                                                                                                                                                                                                            |
| Deploy           | Docker images: `web` and `worker`; docker compose for local deps     |                                                                                                                                                                                                                                            |

### 2.1 Authentication decision (changed from the approved plan)

The plan said Auth.js with database sessions. Auth.js v5 (still beta) only supports the JWT session strategy for the Credentials provider, so email/password login and revocable database sessions cannot be combined there. Phase 1 therefore implements a small session layer following the approach documented by Lucia and OWASP:

- 256-bit random session token in an httpOnly, SameSite=Lax cookie (`__Host-session` in production, which forces Secure and Path=/).
- The database stores only `HMAC-SHA256(AUTH_SECRET, token)` as the session id, so a database dump does not yield usable tokens.
- 30-day sliding expiry, renewed when less than half remains; `proxy.ts` refreshes the cookie's browser expiry.
- Password reset deletes all sessions for the user. Logout deletes the current session.
- Email verification and password reset tokens are HMAC-hashed, single use (atomic claim), and expire after 24 h / 1 h.
- `OAuthAccount` table exists so Google/Microsoft/SSO can be added later (for example with the `arctic` library) without schema redesign.

`AUTH_SECRET` replaces `NEXTAUTH_SECRET` from the brief.

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

## 4. Source layout

Entries marked (later) are planned and do not exist yet.

```
src/
  proxy.ts             request id, CSP nonce + security headers, auth redirect
  instrumentation.ts   validates environment at server start
  app/
    (auth)/            login, signup, forgot/reset password, verify email + server actions
    onboarding/        create workspace
    w/[slug]/          tenant routes (membership checked in layout and every page/action)
      setup/           onboarding steps 2-8
      (shell)/         sidebar app: dashboard, inbox, contacts, campaigns, ... settings
    api/health         liveness/readiness
    api/v1/            (later) public REST API, API-key auth
    api/webhooks/meta  Meta webhook (verification + signed deliveries)
  components/
    ui/                shadcn/ui primitives
    app/               product components (shell, forms, empty states)
  config/
    brand.ts           product name, logo, domain, support email, company, socials
    plans.ts           plan limits and feature flags (no prices)
    navigation.ts      sidebar structure with required permissions
    env.ts             Zod-validated environment
  lib/                 code safe for client and server: permissions matrix, validation, utils
  server/
    auth/              password hashing, tokens, sessions, auth service
    authz/             TenantContext, can/requirePermission
    db/                Prisma client + tenant guard
    workspace/         workspace and member services
    contacts/          contacts, tags, lists, custom fields, segments, import, export
    email/             EmailProvider (SMTP, memory) + templates
    audit/             audit log writer
    logging/           pino logger
    rate-limit.ts      Redis fixed-window limiter
    providers/whatsapp WhatsAppProvider interface + Meta Cloud API implementation
    whatsapp/          connection service (Embedded Signup onboarding), credentials
    webhooks/          Meta webhook ingest + processor
    queue/             BullMQ queues
    crypto/            AES-256-GCM secrets
    providers/         (later) billing/, storage/
  generated/prisma     generated client (git-ignored)
worker/                BullMQ worker entrypoint (npm run worker)
prisma/                schema.prisma, migrations/, seed.ts
tests/
  unit/, integration/, e2e/, support/
```

## 5. Multi-tenancy and authorization

- Shared database, shared schema. Every tenant-owned table has a non-null `workspaceId` and composite indexes leading with `workspaceId`.
- Workspace is resolved server-side from the URL slug plus the session user's `WorkspaceMember` row, or from the API key. The client never supplies a trusted `workspaceId`.
- All tenant data access goes through a `TenantContext` (`{ workspaceId, actor, permissions }`). Service functions take the context as the first argument and always include `workspaceId` in `where` clauses. Lookups by id use `findFirst({ where: { id, workspaceId } })`, never `findUnique({ id })` alone.
- A Prisma client extension (`src/server/db/tenant-guard.ts`) rejects queries on tenant models that lack a `workspaceId` filter (defense in depth). Every new tenant-owned model must be added to `TENANT_MODELS`. Tests assert cross-tenant access returns 404.
- Optional later hardening: PostgreSQL Row Level Security keyed on a session variable. Not in V1 because it complicates Prisma connection pooling; the decision is documented, not ignored.

### Permissions

Roles map to permission sets in one file (`server/authz/permissions.ts`). UI and server both use `can(ctx, "campaign:send")`; only the server check is authoritative.

| Permission group                              | OWNER | ADMIN                | AGENT | ANALYST     |
| --------------------------------------------- | ----- | -------------------- | ----- | ----------- |
| inbox read/reply/assign                       | yes   | yes                  | yes   | read only   |
| contacts read/write                           | yes   | yes                  | yes   | read only   |
| contacts delete/import/export                 | yes   | yes                  | no    | export only |
| templates manage                              | yes   | yes                  | no    | no          |
| campaigns create/send                         | yes   | yes                  | no    | no          |
| analytics/reports                             | yes   | yes                  | no    | yes         |
| automations manage                            | yes   | yes                  | no    | no          |
| team invite/remove/role                       | yes   | yes (not OWNER role) | no    | no          |
| WhatsApp connection                           | yes   | yes                  | no    | no          |
| API keys and webhooks                         | yes   | yes                  | no    | no          |
| billing, ownership transfer, workspace delete | yes   | no                   | no    | no          |

## 6. WhatsApp integration

**Connection model (decided 2026-10-01):** the platform is a Meta **Tech Provider** and businesses connect with **Embedded Signup** ("Connect with Facebook"). There is one platform Meta app (`WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_CONFIG_ID`); each business's own token comes from the signup flow. Setup steps for the platform owner are in `docs/META_SETUP_GUIDE.md`.

Flow:

1. Browser loads the Facebook SDK (only on the setup and WhatsApp settings pages, which get a wider CSP), calls `FB.login` with the configuration ID.
2. Meta's window returns the WABA ID and phone number ID (`postMessage`, origin checked to be facebook.com) and a code (30 s TTL).
3. Server action `completeConnectionAction` → `completeEmbeddedSignup()` (`src/server/whatsapp/connection.ts`): exchange code → business token; list the WABA's phone numbers with that token to confirm the returned IDs (rejects forged IDs); store token and a generated 6-digit PIN encrypted; subscribe app to WABA webhooks; register the number; read quality, limit and name status.
4. If subscribe/register fails the account stays `PENDING_SETUP` with a user-safe reason and "Finish setup" retries only the missing steps (registration is limited to 10 tries per 72 h by Meta).

All Meta calls go through `WhatsAppProvider` (`src/server/providers/whatsapp/types.ts`), implemented by `MetaCloudProvider` on top of `GraphClient`, which adds `appsecret_proof`, timeouts, error mapping (`MetaApiError` with a user-safe message per documented code) and records call metadata (never tokens or bodies) in `ProviderApiLog`. Phase 4 added `sendMessage`, `uploadMedia`, `getMediaInfo`, `downloadMedia`, `listTemplates`, `getTemplate`, `createTemplate` and `deleteTemplate`.

Credentials: AES-256-GCM (`src/server/crypto/secrets.ts`) with key id for rotation, stored in `Credential`, referenced by `WhatsAppAccount.accessTokenRef` / `registrationPinRef`, decrypted only server-side.

A phone number can belong to one workspace (unique `phoneNumberId`). Webhook routing and that uniqueness check are the only cross-tenant reads; they use the explicitly named `systemDb` client instead of the tenant-guarded `db`.

### Webhooks (inbound from Meta)

`/api/webhooks/meta`: GET handles the verification handshake (`WHATSAPP_VERIFY_TOKEN`); POST verifies `X-Hub-Signature-256` on the raw body, splits deliveries into one `WebhookEvent` per message/status/change with a stable `dedupeKey` (unique; Meta retries for up to 7 days and may re-batch), routes to a workspace by phone number ID or WABA ID, returns 200 and enqueues a BullMQ job per new event. If storing fails it returns 503 so Meta retries. The worker (`npm run worker`, separate process and Docker target) processes events; a sweeper re-enqueues events stored while Redis was down. Phase 3 handlers: `account_update` (uninstall/deletion/restriction → account status), `phone_number_quality_update` (messaging limit), `user_preferences` (marketing stop/resume → contact opt-out/opt-in). Phase 4 handlers (`src/server/messaging/inbound.ts`): `messages` (incoming messages create or update the contact, conversation and message, and queue media downloads; statuses update outbound messages) and `message_template_status_update`. Events stored as `DEFERRED` before Phase 4 are replayed by the worker sweeper in arrival order.

### Customer service window

Free-form messages are allowed for 24 hours after the contact's last inbound message or call (verified). `Conversation.lastInboundAt` holds the last customer message time (only moved forward). `createOutboundMessage` refuses free-form messages when `lastInboundAt + 24h` has passed and points the user to approved templates; the inbox composer shows the remaining time. Meta remains the final authority (error `131047`).

## 7. Messaging pipeline and idempotency

Implemented in Phase 4 (`src/server/messaging/outbound.ts`):

1. A send request (inbox now; campaigns, API and automations later) calls `createOutboundMessage`, which validates the rules below and creates a `Message` with status `QUEUED` plus a `QUEUED` `MessageEvent`. An optional `idempotencyKey` (unique per workspace) makes the request safe to repeat: the inbox composer sends a fresh key per message, so a double click returns the original message.
2. A BullMQ job (`outbound-messages`) is added with `jobId = message.id`, so enqueueing twice is a no-op.
3. The worker's `deliverMessage` claims the row with `UPDATE ... SET status = 'SENDING' WHERE id = ? AND status = 'QUEUED'`. Only one caller can win, so a message reaches Meta at most once. The message id is sent as `biz_opaque_callback_data`, so status webhooks can be matched even if the process dies before saving the wamid.
4. Outcomes: Meta accepts → `ACCEPTED` with the wamid; Meta refuses with a retryable code (rate limit, temporary) or the request never left (DNS, connection refused) → back to `QUEUED` and retried with backoff; permanent error → `FAILED` with Meta's code and a user-safe message; **no response** (timeout after sending) → stays `SENDING` and is never retried. The reconciler marks `SENDING` messages older than one hour as `FAILED` ("not confirmed"); a later status webhook that matches by `biz_opaque_callback_data` corrects it.
5. Rules checked at creation and again at delivery: the WhatsApp number must be connected; non-template messages only inside the customer service window; templates must be `APPROVED`; `MARKETING` templates are never sent to `OPTED_OUT` contacts. Meta error `131050` (user stopped marketing messages) marks the contact opted out; auth errors mark the number "Needs reconnecting".
6. Per-number rate limiting is added with campaigns in Phase 5 (Meta's documented default is 80 messages per second per number).
7. Status webhooks append to `MessageEvent` (unique per message and type, so replays are no-ops) and move `Message.status` forward only (`QUEUED < SENDING < ACCEPTED < SENT < DELIVERED < READ`). "read" implies "delivered". A failure never overrides a delivered or read message.

Internal notes are a separate table (`ConversationNote`) with no code path to the send queue.

Media (`src/server/messaging/media.ts`, `src/server/storage`): incoming media is downloaded by the `media-downloads` worker queue (fresh 5-minute URL per attempt, bearer token) into object storage (`STORAGE_DRIVER=local` or `s3`). Team uploads are checked against WhatsApp's types and sizes and by file signature, stored, and uploaded to Meta on first send (ids reused for 29 days per number). Files are served only through `/w/[slug]/inbox/media/[id]` after a workspace permission check, with `nosniff`, a sandbox CSP and attachment disposition for non-media types.

## 8. Webhooks

Inbound (Meta): `GET /api/webhooks/meta` handles the verification handshake; `POST` verifies `X-Hub-Signature-256` against the raw body with the app secret, stores the raw payload in `WebhookEvent` with a dedupe key (provider + message id + status, or a body hash), returns 200 quickly, and enqueues processing. Processing is idempotent through the unique dedupe key and forward-only status rules.

Outbound (customer): `WebhookEndpoint` rows per workspace with a generated secret. Deliveries are signed (`X-WhatsFlow-Signature: t=<ts>,v1=<hmac-sha256>`), retried with backoff, and logged in `WebhookDelivery` for the UI.

## 9. Configuration

- `src/config/brand.ts`: product name, logo path, domain, support email, company name, social links. Overridable through `NEXT_PUBLIC_BRAND_*` env vars.
- `src/config/plans.ts`: plan ids, limits, feature flags. Prices live in the billing provider (Stripe price ids in env), not in code.
- `src/config/env.ts`: Zod schema; the app fails fast on missing or invalid env.

## 10. Security baseline

argon2id hashing; database sessions with httpOnly, secure, sameSite=lax cookies; CSRF protection from Next.js Server Actions (POST only, Origin must match Host) plus SameSite cookies, and explicit origin checks for any future cookie-authenticated route handlers; Zod validation at every boundary; Redis-backed rate limiting on auth, API and webhook routes; security headers (nonce-based CSP, HSTS, X-Frame-Options, Referrer-Policy) in `src/proxy.ts` (Next 16 renamed middleware to proxy); API keys stored as SHA-256 hashes with a visible prefix; secrets encrypted at rest; media served only through short-lived presigned URLs after an authorization check; audit log table written by services, never by the client; admin area guarded by a separate `isPlatformAdmin` flag and message bodies redacted by default.

## 11. Observability

pino JSON logs with `requestId` (from header or generated in `src/proxy.ts`) and `jobId`/`messageId`/`campaignId` bindings in workers. `ProviderApiLog` stores Meta request metadata, status code and error body (no tokens) linked to `messageId`, which gives the debug chain Campaign -> CampaignRecipient -> Message -> ProviderApiLog -> WebhookEvent/MessageEvent.

## 12. External dependencies

| Dependency                          | Used for                                                                       | Needed from phase          |
| ----------------------------------- | ------------------------------------------------------------------------------ | -------------------------- |
| Meta WhatsApp Cloud API (Graph API) | Sending, templates, phone status, media                                        | 3                          |
| Meta webhooks                       | Inbound messages, statuses, template updates                                   | 3                          |
| Stripe                              | Subscription billing                                                           | 9                          |
| S3-compatible storage               | Media (CSV imports are kept in PostgreSQL until processed; see Phase 2 report) | 4                          |
| SMTP / email provider               | Verification, reset, invites, notifications                                    | 1                          |
| Redis                               | Queues, rate limiting                                                          | 1 (rate limit), 5 (queues) |

## 13. Data stored and why (privacy summary)

Detailed in `docs/PRIVACY.md` (Phase 10). Summary: account data (to authenticate), contact data supplied by the customer (to message their customers), message content and media (to show the inbox), delivery events (analytics), audit logs (security). Workspace deletion performs a hard delete of tenant rows and media after a grace period; contact deletion removes the contact and its PII from messages.
