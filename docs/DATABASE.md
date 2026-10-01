# Database Schema

PostgreSQL 16 via Prisma 7. Phase 1 models are implemented in `prisma/schema.prisma`; later-phase models below are still the plan.

## Conventions

- Primary keys: `cuid` strings (Prisma `@default(cuid())`). Session ids are token hashes. Public API objects use prefixed public ids (`ct_...`, `msg_...`, `cmp_...`) stored in a unique `publicId` column, so internal ids are not exposed through the API.
- Every tenant-owned table has `workspaceId` (non-null, FK, `onDelete: Cascade`), and composite indexes lead with it.
- Timestamps are `timestamptz` (`createdAt`, `updatedAt`).
- Enums are Postgres enums via Prisma.
- Soft delete is not used by default. Deletion is real deletion, which simplifies privacy requirements. Exceptions are noted.

## Phase 1 models (implemented)

| Model                  | Key fields (beyond the brief)                                                                                             | Notes                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| User                   | `passwordHash?`, `emailVerifiedAt?`, `isPlatformAdmin`, `isDemo`                                                          | Hash only, never selected into session or UI objects |
| OAuthAccount           | `provider`, `providerAccountId`                                                                                           | Reserved for future Google/Microsoft/SSO login       |
| Session                | id = HMAC of token, `expiresAt`, `ipAddress`, `userAgent`, `lastSeenAt`                                                   | Revocable server-side                                |
| EmailVerificationToken | `tokenHash`, `expiresAt`, `usedAt`                                                                                        | Single use, 24 h                                     |
| PasswordResetToken     | `tokenHash`, `expiresAt`, `usedAt`                                                                                        | Single use, 1 h; raw token only in the email         |
| Workspace              | `name`, `slug` (unique), `businessName`, `logoUrl`, `timezone`, `currency`, `planId`, `onboardingStep`, `isDemo`          | `isDemo` marks seed data                             |
| WorkspaceMember        | `role` enum OWNER/ADMIN/AGENT/ANALYST                                                                                     | Unique (`workspaceId`, `userId`)                     |
| WorkspaceInvite        | `email`, `role`, `tokenHash`, `expiresAt`, `acceptedAt`                                                                   | Used in Phase 9, created in Phase 1 for onboarding   |
| AuditLog               | `workspaceId?`, `actorUserId?`, `actorApiKeyId?`, `action`, `entityType`, `entityId`, `ip`, `userAgent`, `metadata` JSONB | Append-only                                          |

## Later-phase models

| Model                                        | Phase | Notes                                                                                                                                                                                  |
| -------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contact                                      | 2     | Unique (`workspaceId`, `normalizedPhoneNumber`) prevents duplicates. E.164 normalization via `libphonenumber-js`. `customFields` JSONB. `optInStatus` enum UNKNOWN/OPTED_IN/OPTED_OUT. |
| ContactNote                                  | 2     | Internal notes on a contact                                                                                                                                                            |
| Tag, ContactTag                              | 2     | Unique (`workspaceId`, `name`)                                                                                                                                                         |
| ContactList, ContactListMember               | 2     | Static lists                                                                                                                                                                           |
| Segment                                      | 2     | `definition` JSONB (AND/OR condition tree), compiled to Prisma `where` server-side                                                                                                     |
| CustomFieldDefinition                        | 2     | Typed custom fields so segment filters can be validated                                                                                                                                |
| ImportJob, ImportRow error report            | 2     | CSV file stored in S3, rows processed by worker                                                                                                                                        |
| Credential                                   | 3     | Encrypted secret (`ciphertext`, `iv`, `authTag`, `keyId`)                                                                                                                              |
| WhatsAppAccount                              | 3     | `accessTokenRef` -> Credential. Unique (`phoneNumberId`) across platform so webhooks route to exactly one workspace                                                                    |
| WebhookEvent                                 | 3     | Unique (`provider`, `dedupeKey`). Raw payload JSONB                                                                                                                                    |
| ProviderApiLog                               | 3     | Request/response metadata for Meta calls, no tokens                                                                                                                                    |
| Template                                     | 4     | Unique (`whatsappAccountId`, `name`, `language`)                                                                                                                                       |
| Conversation                                 | 4     | `lastInboundAt`, `windowExpiresAt`, `unreadCount`                                                                                                                                      |
| Message                                      | 4     | Unique `whatsappMessageId`, unique `idempotencyKey`. `isInternalNote` is NOT used: notes are a separate table so they can never reach the send path                                    |
| ConversationNote                             | 4     | Internal notes, never sent                                                                                                                                                             |
| MessageEvent                                 | 4     | Immutable status history, source of truth for analytics                                                                                                                                |
| MediaObject                                  | 4     | S3 key, mime type, size, sha256                                                                                                                                                        |
| Campaign, CampaignRecipient                  | 5     | Unique (`campaignId`, `contactId`) prevents duplicate recipients                                                                                                                       |
| DailyMetric                                  | 6     | Optional rollup table rebuilt from MessageEvent for fast dashboards                                                                                                                    |
| Automation, AutomationRun, AutomationStepRun | 7     | JSON workflow definition + execution log                                                                                                                                               |
| ApiKey                                       | 8     | `prefix` (shown), `keyHash` (SHA-256), `scopes`, `revokedAt`                                                                                                                           |
| WebhookEndpoint, WebhookDelivery             | 8     | Signing secret encrypted                                                                                                                                                               |
| Subscription, UsageCounter, BillingEvent     | 9     | Usage counters per workspace per period                                                                                                                                                |
| NotificationPreference                       | 9     | Per member                                                                                                                                                                             |

## Planned indexes (beyond PK/unique)

| Table             | Index                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WorkspaceMember   | (`userId`)                                                                                                                                                 |
| AuditLog          | (`workspaceId`, `createdAt` desc)                                                                                                                          |
| Contact           | (`workspaceId`, `createdAt` desc), (`workspaceId`, `optInStatus`), (`workspaceId`, `phoneNumber`), (`workspaceId`, `lastMessageAt`), GIN on `customFields` |
| ContactTag        | (`tagId`, `contactId`)                                                                                                                                     |
| Conversation      | (`workspaceId`, `status`, `lastMessageAt` desc), (`workspaceId`, `assignedUserId`, `status`), unique (`workspaceId`, `contactId`, `whatsappAccountId`)     |
| Message           | (`workspaceId`, `conversationId`, `createdAt`), (`workspaceId`, `createdAt`), (`workspaceId`, `status`, `createdAt`), (`contactId`, `createdAt`)           |
| MessageEvent      | (`messageId`, `occurredAt`), (`workspaceId`, `type`, `occurredAt`)                                                                                         |
| Template          | (`workspaceId`, `status`)                                                                                                                                  |
| Campaign          | (`workspaceId`, `status`, `scheduledAt`)                                                                                                                   |
| CampaignRecipient | (`campaignId`, `status`), (`messageId`)                                                                                                                    |
| WebhookEvent      | (`processed`, `createdAt`), (`workspaceId`, `createdAt`)                                                                                                   |

Cursor pagination on (`createdAt`, `id`) for contacts, messages and logs.
