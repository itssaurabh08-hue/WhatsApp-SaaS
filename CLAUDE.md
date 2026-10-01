@AGENTS.md

# Project notes

- Read `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` before changing structure; record each phase in `docs/phase-reports/`.
- Tenant data: every query must be scoped by `workspaceId` via a `TenantContext`; add new tenant-owned models to `TENANT_MODELS` in `src/server/db/tenant-guard.ts`.
- Permissions: check with `can`/`requirePermission` from `src/server/authz/tenant.ts`; the matrix lives in `src/lib/permissions.ts`.
- Meta/WhatsApp API behavior must be verified against official docs; track it in `docs/META_API_VERIFICATION.md`.
- Before pushing: `npm run lint && npm run typecheck && npm test`, and `npm run build && npm run test:e2e` for UI changes.
