# Phase 3 Report: WhatsApp connection and Meta webhooks

Date: 2026-10-01

## Decision

Businesses connect WhatsApp with **Meta Embedded Signup** ("Connect with Facebook"). The platform registers with Meta as a **Tech Provider** (chosen by the product owner over manual credential entry). All Meta behavior used was verified against Meta's official documentation first; see `docs/META_API_VERIFICATION.md`.

## What was implemented

- **Connect with Facebook** on Settings > WhatsApp and in onboarding step 3. Loads Meta's SDK only on those pages, launches Embedded Signup with the configuration ID, accepts session info only from facebook.com origins (stricter than Meta's sample suffix check), and sends the code (30 s lifetime) to the server immediately.
- **Server-side onboarding** (`src/server/whatsapp/connection.ts`):
  - exchanges the code for the customer's business token;
  - confirms the token can access the returned WhatsApp Business Account and phone number (rejects forged or mismatched IDs);
  - stores the token and a generated 6-digit PIN with AES-256-GCM;
  - subscribes the app to the account's webhooks and registers the number for Cloud API;
  - reads quality rating, messaging limit and display-name status.
    If a step fails, the number stays in "Setup not finished" with a plain-language reason, and **Finish setup** retries only the missing steps.
- **Account management:** refresh status, disconnect (unsubscribes webhooks, deletes credentials, keeps the number in the customer's Meta account), reconnect after a revoked token ("Needs reconnecting"). One phone number can belong to only one workspace, enforced with race-safe conditional writes.
- **Meta provider layer:**
  - `WhatsAppProvider` interface;
  - `MetaCloudProvider` and `GraphClient`, with `appsecret_proof` on every authenticated call, 15 s timeouts, and documented error codes mapped to user-safe messages and retryability;
  - call metadata recorded in `ProviderApiLog` without tokens, secrets or codes.
- **Webhook endpoint** `/api/webhooks/meta`:
  - verification handshake;
  - `X-Hub-Signature-256` check on the raw body;
  - one stored event per message/status/change with a stable deduplication key (Meta retries for up to 7 days and may re-batch);
  - routing to the workspace by phone number ID or WhatsApp Business Account ID;
  - 503 when storage fails, so Meta retries;
  - a fast 200 response, with processing done by the worker.
- **Background worker** (`npm run worker`, Docker target `worker`): BullMQ queue with retries and exponential backoff, a sweeper for events stored while Redis was down, and a per-environment queue prefix (`QUEUE_PREFIX`).
- **Webhook handlers:**
  - `user_preferences`: a customer stopping marketing messages in WhatsApp opts the contact out, and resuming restores opt-in. Both are audited.
  - `account_update`: app uninstalled, account deleted, offboarded or restricted updates the number's status with an explanation.
  - `phone_number_quality_update`: updates the messaging limit.
  - Incoming messages and template events are stored as **deferred** and will be processed when Phase 4 adds their handlers.
- **Dashboard and onboarding:** the WhatsApp status badge and the "Connect a WhatsApp number" checklist item now reflect real connections; connecting moves onboarding forward.
- **Startup checks:** the server refuses to start with WhatsApp partially configured, or with WhatsApp configured but no valid `ENCRYPTION_KEY`.
- **Docs:** `docs/META_SETUP_GUIDE.md`, a plain-language guide for the platform owner (Meta app, Tech Provider onboarding, Embedded Signup configuration, webhooks, App Review).

## Changes from earlier plans

- The global `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_BUSINESS_ACCOUNT_ID` from the brief are **not used**: in the Tech Provider model each business's token comes from Embedded Signup and is stored encrypted. New variables: `WHATSAPP_CONFIG_ID`, `QUEUE_PREFIX`, and the optional `ENCRYPTION_KEY_ID` / `ENCRYPTION_KEY_PREVIOUS*` for key rotation.
- A second database client, `systemDb` (no tenant guard), is used **only** for webhook routing and the one-number-one-workspace check. Everything else uses the guarded client.
- BullMQ arrived in Phase 3 (planned for Phase 5) because webhooks need asynchronous processing.

## Files changed (main)

- Schema and migration: `prisma/schema.prisma`, `prisma/migrations/*_whatsapp/`
- Server: `src/server/crypto/secrets.ts`, `src/server/providers/whatsapp/**`, `src/server/whatsapp/{connection,credentials}.ts`, `src/server/webhooks/{meta-ingest,meta-processor}.ts`, `src/server/queue/*`, `src/server/db/client.ts` (`systemDb`), `src/server/startup.ts`, `src/proxy.ts` (CSP for Facebook on two pages)
- Routes and UI: `src/app/api/webhooks/meta/route.ts`, `src/app/w/[slug]/(shell)/settings/whatsapp/**`, `src/components/app/connect-whatsapp-button.tsx`, onboarding step, dashboard, navigation
- Worker: `worker/index.ts`, `worker/env.ts`, `Dockerfile` (worker target)
- Tests: `tests/unit/{secrets,meta-webhooks,meta-client}.test.ts`, `tests/integration/{whatsapp-connection,meta-webhooks}.test.ts`, `tests/e2e/whatsapp.spec.ts`, `tests/support/fake-meta.ts`, `tests/e2e/support/fake-graph-server.ts`
- Docs: `META_API_VERIFICATION.md`, `META_SETUP_GUIDE.md`, `ARCHITECTURE.md`, `DATABASE.md`, `ROADMAP.md`, `README.md`, `.env.example`

## Database changes

Migration `whatsapp`: enums `WhatsAppAccountStatus`, `WebhookEventStatus`; tables `Credential`, `WhatsAppAccount` (unique `phoneNumberId`, indexes on `workspaceId`, `businessAccountId`), `WebhookEvent` (unique `provider + dedupeKey`, indexes on `status, createdAt` and `workspaceId, createdAt desc`), `ProviderApiLog` (indexes on `workspaceId, createdAt desc` and `whatsappAccountId, createdAt desc`).

## Environment variables

Required to enable WhatsApp (all four or none): `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_CONFIG_ID`, `WHATSAPP_VERIFY_TOKEN`; plus `ENCRYPTION_KEY`. Optional: `WHATSAPP_GRAPH_API_VERSION` (default `v25.0`), `QUEUE_PREFIX`, `ENCRYPTION_KEY_ID`, `ENCRYPTION_KEY_PREVIOUS`, `ENCRYPTION_KEY_PREVIOUS_ID`. Test-only: `WHATSAPP_GRAPH_BASE_URL`.

## Tests performed

| Check                                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint, typecheck, format, build                 | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Unit                                           | 84 pass (21 new): encryption round-trip, tampering, key rotation; webhook signature and handshake; event splitting and dedupe keys stable across re-batching; Graph client token exchange (JSON and plain text), bearer and `appsecret_proof`, error mapping, network failure, call log free of secrets; env defaults                                                                                                                                                                                                                                                                                                  |
| Integration (Postgres + Redis, fake Graph API) | 76 pass (17 new): full onboarding with encrypted storage and audit; forged IDs rejected with nothing stored; failed code exchange message; registration failure then retry without repeating subscribe; revoked token marks "Needs reconnecting"; one number per workspace; disconnect then another workspace connects; permission and email-verification checks; cross-workspace access blocked; webhook signature rejection, routing, retry deduplication, malformed JSON, deferred and ignored events; marketing stop/resume opt-out; uninstall marks disconnected; messaging limit update; idempotent reprocessing |
| E2E (Playwright, production build)             | 12 pass (3 new): the full **Connect with Facebook** flow in a real browser (Facebook SDK and popup simulated with a facebook.com frame; server talks to a local fake Graph API), connected card, dashboard status and disconnect; Facebook CSP only on connect pages; webhook handshake and signature checks over HTTP                                                                                                                                                                                                                                                                                                 |
| Docker                                         | web and worker images built; worker container started and consumed jobs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Not tested against the real Meta platform: that needs your Meta app, configuration ID and a public HTTPS address (see the guide).

## Remaining issues

- **Real-world test pending:** the flow is verified against Meta's documentation and simulated end to end, not yet against Meta's live servers.
- **Hosting:** Embedded Signup and webhooks need the app on a public HTTPS domain. Not set up yet.
- The JSON shape of the token-exchange response is not shown in Meta's docs; both formats are handled.
- Meta's `account_update` webhook reports `PARTNER_APP_INSTALLED` when access is granted; it is accepted but not used, since onboarding happens through the server action.
- No admin view of webhook events and API logs yet (Phase 10 admin area); they are in the database for debugging.
- Old `WebhookEvent` and `ProviderApiLog` rows are not cleaned up automatically yet (retention job planned).

## Next recommended step

Phase 4: templates (create, submit to Meta, status from webhooks), inbox (process the stored incoming messages, conversations, assignment, internal notes), message composer with the 24-hour window rule, media handling (download incoming media within the 5-minute URL lifetime). This also enables the two App Review videos.
