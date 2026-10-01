# Phase 4 Report: templates, inbox, messaging and media

Date: 2026-10-01

All Meta behavior used was checked against Meta's official documentation first. The new items are in the "Messaging, templates and media" section of `docs/META_API_VERIFICATION.md`.

## What was implemented

- **Templates** (`/templates`):
  - List with tabs: All, Approved, In review, Rejected, Paused or inactive.
  - **Sync from WhatsApp** imports every template of the connected WhatsApp Business Account, including ones made in WhatsApp Manager. Templates no longer in Meta are marked deleted.
  - **New template** editor: name, category (Utility or Marketing), language (Meta's supported list), numbered or named variables, header, body, footer, and quick reply, website and call buttons. It shows a live WhatsApp-style preview and asks for an example value for every variable.
  - Validation follows Meta's documented limits: name format; 60/1024/60 characters for header, body and footer; one header variable; numbered variables in order; at most 2 website buttons and 1 call button; website variable only at the end of the URL.
  - Submitting sends the template to Meta for review. Meta's review result arrives by webhook and updates the status, with the rejection reason shown.
  - Template detail page shows the status, variables and preview, and lets managers delete the template (in Meta too).
  - Authentication templates and image or video headers are created in WhatsApp Manager and then synced. They are listed, and image, video or document headers can be sent.
- **Inbox** (`/inbox`):
  - Conversation list with filters (Open, Mine, Unassigned, Pending, Closed, All), search by name or number, and unread counts.
  - Message thread with delivery ticks (sent, delivered, read), failure reasons, photos, videos, audio and documents, locations, button replies and reactions.
  - Contact panel with opt-in status, tags, link to the contact, assignment, close, reopen and mark pending.
  - Internal notes. They are stored in their own table and have no path to WhatsApp (checked by an integration test and the E2E test).
  - Composer:
    - **Reply**: text, or a file with an optional caption, sent inside the 24-hour window.
    - **Template**: pick an approved template, fill its variables (the contact's first name is pre-filled where it fits) and attach the header file if one is needed, with a live preview.
    - **Internal note**.
  - The page refreshes every 5 seconds while visible, so new messages and statuses appear without reloading.
  - **New conversation**: a contact page has **Send WhatsApp message**, which starts a conversation with a template. Marketing templates are hidden for opted-out contacts. When a conversation already exists, the contact page also shows **Open conversation**.
- **Business rules, enforced on the server:**
  - Free-form messages are allowed only within 24 hours of the customer's last message. Outside the window only approved templates can be sent.
  - Only `APPROVED` templates can be sent.
  - Marketing templates are never sent to opted-out contacts. This is checked when queuing and again just before sending.
  - If Meta reports error 131050 (the customer stopped marketing messages), the contact is marked opted out.
  - Senders need the `inbox:reply` permission and a verified email.
  - Agents can reply and assign. Analysts can read only.
  - Every query is scoped to the workspace, and the six new tables are guarded by the tenant guard.
- **Sending pipeline** (worker queue `outbound-messages`):
  - Each message is claimed atomically before the Meta call, so it reaches Meta at most once, even when jobs are retried or duplicated.
  - Our message id travels in `biz_opaque_callback_data`, so delivery webhooks can be matched to the message.
  - Retries happen only when Meta did not accept the message (rate limit, temporary error, or the request never left).
  - If WhatsApp does not answer (timeout), the message is never re-sent. It shows "Waiting for confirmation" and is marked failed after an hour unless a webhook confirms it.
  - Repeating a request (double click) does not create a second message (idempotency key).
- **Incoming webhooks** (`messages` and `message_template_status_update`):
  - Incoming messages create the contact (source `INBOUND`, opt-in unknown), the conversation and the message.
  - Duplicates from Meta's retries are ignored.
  - Statuses only move forward ("read" implies "delivered"), and a failure never overrides a delivery.
  - Events stored before this phase as "deferred" are replayed in arrival order.
- **Media**:
  - Incoming files are downloaded by the worker (queue `media-downloads`), using a fresh 5-minute link from Meta on each attempt, into object storage.
  - Team uploads are checked against WhatsApp's file types and size limits, and by their real file signature. They are uploaded to Meta on first send.
  - Files are served only to workspace members through `/w/[slug]/inbox/media/[id]`, with safe headers.
  - Storage is local disk (development) or any S3-compatible service.

## Files changed (main)

- Schema and migration: `prisma/schema.prisma`, `prisma/migrations/*_messaging/`
- Shared logic: `src/lib/templates/{index,languages}.ts`, `src/lib/messaging.ts`, `src/lib/media.ts`
- Server:
  - `src/server/messaging/{outbound,inbound,media}.ts`
  - `src/server/templates/service.ts`
  - `src/server/inbox/service.ts`
  - `src/server/storage/index.ts`
  - `src/server/providers/whatsapp/{types,meta/provider,meta/graph-client,meta/errors}.ts`
  - `src/server/webhooks/meta-processor.ts`
  - `src/server/queue/queues.ts`
  - `src/server/pages.ts`
  - `src/server/startup.ts`
  - `src/server/db/tenant-guard.ts`
  - `src/server/audit/audit.ts`
- UI:
  - `src/app/w/[slug]/(shell)/templates/**`
  - `src/app/w/[slug]/(shell)/inbox/**` (page, composer, controls, message bubble, media route, new conversation)
  - `src/components/app/{template-preview,template-composer,template-status-badge}.tsx`
  - contact page buttons
  - `confirm-action.tsx`, which now shows action results
- Worker: `worker/index.ts` (three queues, deferred replay, outbound reconciliation, optional health port)
- Tests:
  - `tests/unit/templates.test.ts`
  - `tests/integration/{messaging,templates}.test.ts`
  - `tests/integration/meta-webhooks.test.ts` (updated)
  - `tests/e2e/inbox.spec.ts`
  - `tests/e2e/support/{whatsapp,fake-graph-server}.ts`
  - `tests/support/fake-meta.ts`
  - `playwright.config.ts` (also starts the worker)
- Docs: `META_API_VERIFICATION.md`, `ARCHITECTURE.md` (sections 6 and 7), `DATABASE.md`, `ROADMAP.md`, `.env.example`, `docker-compose.yml` (MinIO bucket creation)

## Database changes

Migration `messaging`:

- Enums: `TemplateCategory`, `TemplateStatus`, `ConversationStatus`, `MessageDirection`, `MessageStatus`, `MediaStatus`.
- Tables: `Template`, `Conversation`, `ConversationNote`, `Message`, `MessageEvent`, `MediaObject`. Unique constraints and indexes are listed in `docs/DATABASE.md`.
- No drift between the schema and the migrations (`prisma migrate diff` reports no difference).

## Environment variables

New, all optional:

- `STORAGE_DRIVER`: `local` (default) or `s3`.
- `STORAGE_LOCAL_DIR`: default `.data/storage`.
- `S3_FORCE_PATH_STYLE`: default `true`, for MinIO.
- `WORKER_HEALTH_PORT`: a health endpoint for the worker.

The existing `S3_*` variables are used when `STORAGE_DRIVER=s3`. The server refuses to start with an invalid storage setting.

## Tests performed

| Check                                          | Result                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint, typecheck, format, build                 | Pass                                                                                                                                                                                                                                                        |
| Unit                                           | 92 pass (8 new). Covers: template rules (name, variable order, named format, examples, footer, header, buttons, languages, authentication), send requirements, positional ordering, URL encoding, rendering, status mapping, and 24-hour window boundaries. |
| Integration (Postgres + Redis, fake Graph API) | 94 pass (18 new). See the list below.                                                                                                                                                                                                                       |
| E2E (Playwright, production build plus worker) | 13 pass (1 new). See below.                                                                                                                                                                                                                                 |

The new integration tests cover:

- An incoming message is stored once despite Meta retries.
- Media is downloaded with a fresh URL and the bearer token.
- A reply is sent exactly once, with the context and callback id.
- The idempotency key prevents duplicates.
- Free text is refused outside the window, and templates are allowed.
- Missing template variables are refused.
- Marketing templates are blocked for opted-out contacts, both when queuing and at delivery.
- Named parameters and URL encoding are sent correctly.
- Retries happen only on a retryable Meta error; a final failure is recorded.
- A timeout is never re-sent, and is reconciled later by webhook.
- Error 131050 opts the contact out, and error 190 marks the number for reconnecting.
- Statuses move forward only, and "read" implies "delivered".
- A failure never overrides a delivery.
- Notes never reach Meta.
- Roles and workspace isolation are enforced.
- Template creation sends the exact documented payload, and rejection and approval webhooks are handled.
- Duplicate templates and Meta validation messages are handled.
- Sync, re-sync and delete work.
- Only managers can create templates.
- Deferred events are replayed.

The new E2E test covers: sync templates; create a template with a live preview; a signed webhook delivers a customer message, processed by the real worker; it appears in the inbox; a reply reaches the fake Meta API; an internal note is never sent; a template reply is sent.

Not tested against Meta's live servers: that needs your Meta app and a public HTTPS address.

## Remaining issues

- **Real-world test pending** (same as Phase 3): verified against documentation and simulated end to end.
- Creating templates with image, video or document headers, and authentication templates, must be done in WhatsApp Manager (Meta requires its Resumable Upload API for header samples). Synced templates with such headers can be sent.
- Location headers, copy-code buttons, carousels and Flows in templates are shown but cannot be sent from the app yet.
- Read receipts (blue ticks for customers) are not sent. They could be a workspace setting later.
- The inbox updates by refreshing every 5 seconds. A push channel (server-sent events) would be lighter at large scale.
- Uploaded files that were never sent (for example, a reply refused because the window closed) stay in storage until the retention job (Phase 10).
- Not verified in Meta's docs: whether reactions open the 24-hour window. The app treats every incoming message as opening it. If Meta disagrees, the send fails with Meta's window error and the agent sees it.
- The App Review videos can now be recorded in the app: sending a message (inbox) and creating a template (Templates > New template).

## Next recommended step

Phase 5: campaigns (audience from lists, tags and segments; template with variables mapped to contact fields; scheduling; a per-number send rate limit; pause, resume and cancel; progress and results; reply attribution), built on the Phase 4 sending pipeline.
