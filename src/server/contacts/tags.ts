import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { TagColor } from "@/lib/contacts/fields";
import { audit } from "@/server/audit/audit";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import type { RequestMeta } from "@/server/request-meta";

function conflict(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AppError("CONFLICT", { userMessage: message });
  }
  throw error;
}

export async function listTags(ctx: TenantContext) {
  requirePermission(ctx, "contacts:read");
  return db.tag.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true, createdAt: true, _count: { select: { contacts: true } } },
  });
}

export async function createTag(ctx: TenantContext, input: { name: string; color: TagColor }) {
  requirePermission(ctx, "contacts:write");
  try {
    return await db.tag.create({
      data: { ...input, workspaceId: ctx.workspaceId },
      select: { id: true, name: true, color: true },
    });
  } catch (error) {
    conflict(error, "A tag with this name already exists.");
  }
}

export async function updateTag(ctx: TenantContext, id: string, input: { name: string; color: TagColor }) {
  requirePermission(ctx, "contacts:write");
  try {
    const res = await db.tag.updateMany({ where: { id, workspaceId: ctx.workspaceId }, data: input });
    if (res.count === 0) throw new AppError("NOT_FOUND");
  } catch (error) {
    conflict(error, "A tag with this name already exists.");
  }
}

export async function deleteTag(ctx: TenantContext, id: string, meta: Partial<RequestMeta> = {}) {
  requirePermission(ctx, "contacts:delete");
  const res = await db.tag.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  if (res.count === 0) throw new AppError("NOT_FOUND");
  await audit(
    { action: "tag.deleted", workspaceId: ctx.workspaceId, actorUserId: ctx.user.id, entityType: "Tag", entityId: id },
    meta,
  );
}

export async function addTagToContact(ctx: TenantContext, contactId: string, tagId: string) {
  requirePermission(ctx, "contacts:write");
  const [contact, tag] = await Promise.all([
    db.contact.findFirst({ where: { id: contactId, workspaceId: ctx.workspaceId }, select: { id: true } }),
    db.tag.findFirst({ where: { id: tagId, workspaceId: ctx.workspaceId }, select: { id: true } }),
  ]);
  if (!contact || !tag) throw new AppError("NOT_FOUND");
  await db.contactTag.createMany({ data: [{ workspaceId: ctx.workspaceId, contactId, tagId }], skipDuplicates: true });
}

export async function removeTagFromContact(ctx: TenantContext, contactId: string, tagId: string) {
  requirePermission(ctx, "contacts:write");
  await db.contactTag.deleteMany({ where: { workspaceId: ctx.workspaceId, contactId, tagId } });
}

/** Finds or creates tags by name (case-insensitive match on existing names). Used by CSV import. */
export async function ensureTagsByName(ctx: TenantContext, names: string[]): Promise<Map<string, string>> {
  // De-duplicate case-insensitively, keeping the first spelling seen.
  const byLowerName = new Map<string, string>();
  for (const n of names.map((x) => x.trim()).filter(Boolean))
    if (!byLowerName.has(n.toLowerCase())) byLowerName.set(n.toLowerCase(), n);
  const wanted = [...byLowerName.values()];
  const result = new Map<string, string>();
  if (wanted.length === 0) return result;
  const existing = await db.tag.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true } });
  const byLower = new Map(existing.map((t) => [t.name.toLowerCase(), t.id]));
  const missing = wanted.filter((n) => !byLower.has(n.toLowerCase()));
  if (missing.length > 0) {
    await db.tag.createMany({
      data: missing.map((name) => ({ workspaceId: ctx.workspaceId, name })),
      skipDuplicates: true,
    });
    const created = await db.tag.findMany({
      where: { workspaceId: ctx.workspaceId, name: { in: missing } },
      select: { id: true, name: true },
    });
    for (const t of created) byLower.set(t.name.toLowerCase(), t.id);
  }
  for (const n of wanted) {
    const id = byLower.get(n.toLowerCase());
    if (id) result.set(n.toLowerCase(), id);
  }
  return result;
}
