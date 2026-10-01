/**
 * Defense-in-depth for tenant isolation. Any query on a tenant-owned model must
 * filter by workspaceId (reads/updates/deletes) or set it (creates). Services
 * are still responsible for passing the right workspaceId; this guard catches
 * the case where a developer forgets it entirely.
 *
 * Add every new tenant-owned model to TENANT_MODELS as it is introduced.
 */
export const TENANT_MODELS = new Set<string>([
  "WorkspaceInvite",
  "Contact",
  "Tag",
  "ContactTag",
  "ContactList",
  "ContactListMember",
  "ContactNote",
  "CustomFieldDefinition",
  "Segment",
  "ImportJob",
  "ImportRowError",
  "Credential",
  "WhatsAppAccount",
]);

export class TenantScopeError extends Error {
  constructor(model: string, operation: string) {
    super(`Tenant guard: ${model}.${operation} must be scoped by workspaceId`);
    this.name = "TenantScopeError";
  }
}

type Args = Record<string, unknown> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the where clause pins workspaceId at the top level or via a compound unique key. */
export function whereHasWorkspace(where: unknown): boolean {
  if (!isRecord(where)) return false;
  if (where.workspaceId !== undefined && where.workspaceId !== null) return true;
  return Object.entries(where).some(
    ([key, value]) => key.includes("workspaceId") && isRecord(value) && value.workspaceId != null,
  );
}

function dataHasWorkspace(data: unknown): boolean {
  if (Array.isArray(data)) return data.length > 0 && data.every(dataHasWorkspace);
  if (!isRecord(data)) return false;
  if (typeof data.workspaceId === "string") return true;
  const relation = data.workspace;
  return isRecord(relation) && isRecord(relation.connect) && relation.connect.id != null;
}

const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);

export function assertTenantScoped(model: string | undefined, operation: string, args: Args) {
  if (!model || !TENANT_MODELS.has(model)) return;
  if (CREATE_OPS.has(operation)) {
    if (!dataHasWorkspace(args?.data)) throw new TenantScopeError(model, operation);
    return;
  }
  if (operation === "upsert") {
    if (!whereHasWorkspace(args?.where) || !dataHasWorkspace(args?.create)) {
      throw new TenantScopeError(model, operation);
    }
    return;
  }
  if (!whereHasWorkspace(args?.where)) throw new TenantScopeError(model, operation);
}
