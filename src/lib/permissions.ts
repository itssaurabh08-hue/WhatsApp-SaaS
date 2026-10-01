/**
 * Role -> permission matrix. Shared by server (authoritative) and UI (cosmetic
 * hiding only). Add new permissions here; never compare roles directly in code.
 */
export const ROLES = ["OWNER", "ADMIN", "AGENT", "ANALYST"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "workspace:read",
  "workspace:update",
  "workspace:delete",
  "workspace:transfer_ownership",
  "billing:read",
  "billing:manage",
  "team:read",
  "team:invite",
  "team:remove",
  "team:change_role",
  "inbox:read",
  "inbox:reply",
  "inbox:assign",
  "contacts:read",
  "contacts:write",
  "contacts:delete",
  "contacts:import",
  "contacts:export",
  "contacts:manage_fields",
  "segments:manage",
  "templates:read",
  "templates:manage",
  "campaigns:read",
  "campaigns:manage",
  "campaigns:send",
  "analytics:read",
  "automations:read",
  "automations:manage",
  "whatsapp:read",
  "whatsapp:manage",
  "api_keys:manage",
  "webhooks:manage",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OWNER_ONLY: Permission[] = ["workspace:delete", "workspace:transfer_ownership", "billing:manage"];

const ADMIN: Permission[] = PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p));

const AGENT: Permission[] = [
  "workspace:read",
  "team:read",
  "inbox:read",
  "inbox:reply",
  "inbox:assign",
  "contacts:read",
  "contacts:write",
  "templates:read",
  "campaigns:read",
  "whatsapp:read",
];

const ANALYST: Permission[] = [
  "workspace:read",
  "team:read",
  "inbox:read",
  "contacts:read",
  "contacts:export",
  "contacts:manage_fields",
  "segments:manage",
  "templates:read",
  "campaigns:read",
  "analytics:read",
  "automations:read",
  "whatsapp:read",
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(PERMISSIONS),
  ADMIN: new Set(ADMIN),
  AGENT: new Set(AGENT),
  ANALYST: new Set(ANALYST),
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Roles a member with `actorRole` may assign to others. Only owners can create owners. */
export function assignableRoles(actorRole: Role): Role[] {
  if (actorRole === "OWNER") return [...ROLES];
  if (actorRole === "ADMIN") return ["ADMIN", "AGENT", "ANALYST"];
  return [];
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  AGENT: "Agent",
  ANALYST: "Analyst",
};
