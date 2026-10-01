# Phase 2 Report: Contacts, tags, lists, segments, CSV import and export

Date: 2026-10-01

## What was implemented

- **Contacts:** add, edit, delete, detail page (details, custom fields, opt-in status with history timestamps, tags, lists, internal notes, placeholders for conversation and campaign history that arrive in Phases 4 and 5).
- **Phone numbers:** normalized to E.164 with `libphonenumber-js` (full metadata). Accepts `+91 ...`, `(+91) ...`, `0091 ...` and national numbers with a default country (per contact, per import, or the new workspace setting **Default country for phone numbers**). One contact per normalized number per workspace, enforced by a unique index; the duplicate error links to the existing contact.
- **Contacts table:** server-side search (name, email, company, phone digits), filters (tag, list, segment, opt-in status), sorting (newest, oldest, name), cursor pagination, page selection plus "select all N matching", bulk add/remove tag, add to / remove from list, bulk delete with confirmation.
- **Tags** (with colors and contact counts), **lists**, **custom fields** (text, number, date, yes/no; stored as normalized strings), **internal notes** (separate table, never part of any send path).
- **Segments:** saved audiences with ALL (AND) / ANY (OR) conditions on tag, list, opt-in status, first/last name, email, company, country, phone, custom fields, date added and last message date. Live "count matching contacts", usable as a contacts filter. Conditions are validated with Zod and compiled to tenant-scoped Prisma filters on the server.
- **CSV import:** upload (5 MB / 100,000 rows), defensive parsing (BOM, delimiter detection, quoted fields, blank and duplicate headers, ragged rows, binary files), automatic column mapping suggestions, per-row validation (phone, email, country, opt-in values, custom field types), duplicate detection within the file and against existing contacts, preview with counts and sample rows, explicit confirmation, import with "update" or "skip" for existing contacts, tags from a column and/or applied to every row, optional list, downloadable CSV of failed rows with the error per row.
- **Opt-out protection:** an import never changes an opted-out contact back to opted in; the preview says how many are affected. Opt-in changes are timestamped and audited.
- **CSV export:** streams matching contacts (same filters as the table) in batches, includes tags and custom fields, neutralizes spreadsheet formula injection, UTF-8 BOM for Excel.
- **Dashboard and onboarding:** contact count and "Import contacts" checklist item are now real; the onboarding contacts step links to the importer.
- **Seed:** 200 clearly labeled demo contacts with tags, a list, a custom field and a segment.

## Decisions and deviations

- **Import runs synchronously in the request** (server action). Measured: 20,000 rows in 6.5 s on the test machine. Moving imports to a BullMQ background job (with progress reporting) is planned for Phase 5, when the queue infrastructure exists. Until then the upload limit is 5 MB / 100,000 rows.
- **Uploaded CSV files are stored in PostgreSQL** (`ImportJob.csvContent`) until the import runs, then cleared; failed rows are kept in `ImportRowError` for the report. S3 storage was not needed for files of this size. Abandoned uploads (never imported) are not yet cleaned up automatically; a scheduled cleanup job is planned with the queue in Phase 5.
- **Server Action body limit raised to 6 MB** (`next.config.ts`) to allow 5 MB uploads. The proxy buffers up to 10 MB by default.
- **Segments are one level** (ALL or ANY of up to 20 conditions). Nested groups can be added later by bumping the definition `version`. Conditions on "last campaign" and "campaign engagement" from the brief need campaign data and will be added in Phase 5.
- **New permissions:** `contacts:manage_fields` (custom field definitions) and `segments:manage`, both OWNER/ADMIN only. Agents can create and tag contacts and create tags/lists; deleting contacts, tags or lists needs `contacts:delete` (OWNER/ADMIN).
- **Join tables carry `workspaceId`** so every tenant table is directly scoped and covered by the tenant guard.

## Files changed (main)

- Schema and migration: `prisma/schema.prisma`, `prisma/migrations/*_contacts/`
- Libraries: `src/lib/phone.ts`, `src/lib/csv.ts`, `src/lib/segments.ts`, `src/lib/contacts/*`, `src/lib/validation/{contacts,imports}.ts`
- Services: `src/server/contacts/{service,bulk,tags,lists,custom-fields,segments,imports,export,where}.ts`, `src/server/authz/route.ts`
- UI: `src/app/w/[slug]/(shell)/contacts/**`, `src/components/app/{contact-form,confirm-action,entity-form-dialog,tag-badge,opt-in-badge}.tsx`, `src/components/ui/{dialog,textarea}.tsx`
- Settings/onboarding/dashboard updates, seed, navigation, permissions, tenant guard list
- Tests: `tests/unit/{phone,csv,contact-fields,segments,import-validation}.test.ts`, `tests/integration/{contacts,segments,imports}.test.ts`, `tests/e2e/contacts.spec.ts`, `tests/e2e/support/session.ts`

## Database changes

Migration `contacts` adds enums `OptInStatus`, `ContactSource`, `CustomFieldType`, `ImportStatus`; tables `Contact`, `Tag`, `ContactTag`, `ContactList`, `ContactListMember`, `ContactNote`, `CustomFieldDefinition`, `Segment`, `ImportJob`, `ImportRowError`; column `Workspace.defaultCountry`. Indexes: unique `(workspaceId, normalizedPhoneNumber)`, `(workspaceId, createdAt desc, id)`, `(workspaceId, firstName, id)`, `(workspaceId, optInStatus)`, `(workspaceId, email)`, `(workspaceId, lastMessageAt)`, GIN on `customFields`, `(workspaceId, tagId)` on tags, `(workspaceId, contactId)` on list members, `(workspaceId, contactId, createdAt desc)` on notes, `(workspaceId, createdAt desc)` on imports, `(importJobId, rowNumber)` on import errors.

## Environment variables

No new variables.

## Tests performed

| Check                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`, `npm run typecheck`, `npm run format:check`   | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Unit tests                                                    | 63 pass (30 new): phone normalization, CSV parsing/limits/injection escaping, column mapping, opt-in parsing, custom value coercion, opt-in transitions, segment schema, row validation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Integration tests (Postgres + Redis)                          | 59 pass (30 new): contact create/update/delete, duplicate prevention across formats, default country, custom field validation, opt-in timestamps and audit, cursor pagination with tied timestamps, search, tag filter, cross-workspace access (read/update/delete/tag/note/bulk), role permissions, note ownership, bulk tag/untag/delete by filter, case-insensitive tag creation, segment AND/OR and every operator incl. JSON custom fields, import preview counts, full import (create/update/skip, opt-out preserved, merged custom fields, tags, list), double-run protection, error report, invalid uploads, 20k-row import, export scoping/escaping/audit/permission |
| E2E (Playwright, production build)                            | 9 pass (3 new): add contact, duplicate rejected, tag, note, delete with confirmation; CSV import through mapping, preview, confirm, results and failed-rows download; bulk tag all matching, search, segment builder with live count, CSV export download                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run build`                                               | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Migrations                                                    | applied to dev/test/e2e; no drift                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Performance at 100,000 contacts (real service calls, test DB) | first page + total count 13 ms; cursor page 2 13 ms; sort by name 13 ms; tag filter 36 ms; opt-in filter 10 ms; name search 95 ms; phone search 99 ms; segment count (tag AND custom field) 58 ms                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Remaining issues

- Import is synchronous (see decisions). A 100,000-row update-heavy import may take tens of seconds; background processing comes in Phase 5.
- Free-text search uses `ILIKE '%term%'` (sequential scan, ~95 ms at 100k contacts). At 1M+ contacts add a `pg_trgm` GIN index.
- Segment counts on the Segments page run one count per segment on each page view.
- "Previous page" is not offered (cursor pagination offers next and first page).
- Plan contact limits from `src/config/plans.ts` are displayed but not enforced yet (Phase 9).
- Abandoned uploads are not cleaned up automatically yet (Phase 5).
- Role-specific UI for agents/analysts is covered by service-level tests; E2E coverage for roles needs team invitations (Phase 9).

## Next recommended step

Phase 3: WhatsApp connection and Meta webhook endpoint (credential encryption, phone number status, signature verification, idempotent raw event storage). This requires verifying the items in `docs/META_API_VERIFICATION.md` against Meta's official documentation first; `developers.facebook.com` is blocked from this build environment, so either allow that host in the environment's network settings or have someone confirm those items.
