import { db } from "@/server/db/client";
import { hashPassword } from "@/server/auth/password";
import type { WorkspaceRole } from "@/generated/prisma/client";
import type { TenantContext } from "@/server/authz/tenant";

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function createUser(
  overrides: { email?: string; name?: string; password?: string; verified?: boolean } = {},
) {
  const id = unique();
  return db.user.create({
    data: {
      email: overrides.email ?? `user-${id}@example.com`,
      name: overrides.name ?? `User ${id}`,
      passwordHash: await hashPassword(overrides.password ?? "correct-horse-battery"),
      emailVerifiedAt: overrides.verified === false ? null : new Date(),
    },
  });
}

export async function createWorkspaceWithMember(userId: string, role: WorkspaceRole = "OWNER") {
  const id = unique();
  return db.workspace.create({
    data: { name: `Workspace ${id}`, slug: `ws-${id}`, members: { create: { userId, role } } },
  });
}

export async function addMember(workspaceId: string, userId: string, role: WorkspaceRole) {
  return db.workspaceMember.create({ data: { workspaceId, userId, role } });
}

/** Builds a TenantContext the same way getTenantContext does, without Next request APIs. */
export async function tenantContextFor(userId: string, slug: string): Promise<TenantContext> {
  const { loadTenantContext } = await import("@/server/authz/tenant");
  const membership = await loadTenantContext(userId, slug);
  if (!membership) throw new Error("not a member");
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, emailVerifiedAt: true, avatarUrl: true, isPlatformAdmin: true },
  });
  return { workspace: membership.workspace, workspaceId: membership.workspace.id, user, role: membership.role };
}

/** Owner + workspace + context in one call. */
export async function ownerContext(opts: { defaultCountry?: string } = {}) {
  const user = await createUser();
  const ws = await createWorkspaceWithMember(user.id, "OWNER");
  if (opts.defaultCountry)
    await db.workspace.update({ where: { id: ws.id }, data: { defaultCountry: opts.defaultCountry } });
  return tenantContextFor(user.id, ws.slug);
}

/** Adds a member with `role` to the context's workspace and returns their context. */
export async function memberContext(ownerCtx: TenantContext, role: WorkspaceRole) {
  const user = await createUser();
  await addMember(ownerCtx.workspaceId, user.id, role);
  return tenantContextFor(user.id, ownerCtx.workspace.slug);
}

let phoneCounter = 1000000;
/** Unique valid Indian mobile numbers for tests. */
export function testPhone() {
  phoneCounter += 1;
  return `+9198${String(phoneCounter).padStart(8, "0")}`;
}
