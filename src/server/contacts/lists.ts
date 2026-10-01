import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";

function conflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AppError("CONFLICT", { userMessage: "A list with this name already exists." });
  }
  throw error;
}

export async function listContactLists(ctx: TenantContext) {
  requirePermission(ctx, "contacts:read");
  return db.contactList.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, createdAt: true, _count: { select: { members: true } } },
  });
}

export async function createContactList(ctx: TenantContext, input: { name: string; description: string | null }) {
  requirePermission(ctx, "contacts:write");
  try {
    return await db.contactList.create({ data: { ...input, workspaceId: ctx.workspaceId }, select: { id: true } });
  } catch (error) {
    conflict(error);
  }
}

export async function updateContactList(
  ctx: TenantContext,
  id: string,
  input: { name: string; description: string | null },
) {
  requirePermission(ctx, "contacts:write");
  try {
    const res = await db.contactList.updateMany({ where: { id, workspaceId: ctx.workspaceId }, data: input });
    if (res.count === 0) throw new AppError("NOT_FOUND");
  } catch (error) {
    conflict(error);
  }
}

/** Deleting a list removes memberships only; contacts are kept. */
export async function deleteContactList(ctx: TenantContext, id: string) {
  requirePermission(ctx, "contacts:delete");
  const res = await db.contactList.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  if (res.count === 0) throw new AppError("NOT_FOUND");
}
