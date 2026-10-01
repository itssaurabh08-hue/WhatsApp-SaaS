import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ContactFilter } from "@/lib/validation/contacts";
import { audit } from "@/server/audit/audit";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import type { RequestMeta } from "@/server/request-meta";
import { buildContactWhere } from "./service";

/** Either explicit ids (current page selection) or every contact matching a filter. */
export type ContactSelection = { ids: string[] } | { filter: ContactFilter };

const MAX_EXPLICIT_IDS = 1000;
const BATCH = 5000;

async function selectionWhere(ctx: TenantContext, selection: ContactSelection): Promise<Prisma.ContactWhereInput> {
  if ("ids" in selection) {
    if (selection.ids.length === 0) throw new AppError("VALIDATION", { userMessage: "Select at least one contact." });
    if (selection.ids.length > MAX_EXPLICIT_IDS)
      throw new AppError("VALIDATION", { userMessage: "Too many contacts selected." });
    return { workspaceId: ctx.workspaceId, id: { in: selection.ids } };
  }
  return buildContactWhere(ctx, selection.filter);
}

/** Streams matching contact ids in keyset-paginated batches, so 100k+ selections stay bounded in memory. */
async function* idBatches(where: Prisma.ContactWhereInput) {
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.contact.findMany({
      where,
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });
    if (rows.length === 0) return;
    yield rows.map((r) => r.id);
    if (rows.length < BATCH) return;
    cursor = rows.at(-1)!.id;
  }
}

async function requireTag(ctx: TenantContext, tagId: string) {
  const tag = await db.tag.findFirst({ where: { id: tagId, workspaceId: ctx.workspaceId }, select: { id: true } });
  if (!tag) throw new AppError("NOT_FOUND", { userMessage: "That tag no longer exists." });
}

async function requireList(ctx: TenantContext, listId: string) {
  const list = await db.contactList.findFirst({
    where: { id: listId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!list) throw new AppError("NOT_FOUND", { userMessage: "That list no longer exists." });
}

export async function bulkAddTag(ctx: TenantContext, selection: ContactSelection, tagId: string): Promise<number> {
  requirePermission(ctx, "contacts:write");
  await requireTag(ctx, tagId);
  let count = 0;
  for await (const ids of idBatches(await selectionWhere(ctx, selection))) {
    const res = await db.contactTag.createMany({
      data: ids.map((contactId) => ({ workspaceId: ctx.workspaceId, contactId, tagId })),
      skipDuplicates: true,
    });
    count += res.count;
  }
  return count;
}

export async function bulkRemoveTag(ctx: TenantContext, selection: ContactSelection, tagId: string): Promise<number> {
  requirePermission(ctx, "contacts:write");
  await requireTag(ctx, tagId);
  const res = await db.contactTag.deleteMany({
    where: { workspaceId: ctx.workspaceId, tagId, contact: await selectionWhere(ctx, selection) },
  });
  return res.count;
}

export async function bulkAddToList(ctx: TenantContext, selection: ContactSelection, listId: string): Promise<number> {
  requirePermission(ctx, "contacts:write");
  await requireList(ctx, listId);
  let count = 0;
  for await (const ids of idBatches(await selectionWhere(ctx, selection))) {
    const res = await db.contactListMember.createMany({
      data: ids.map((contactId) => ({ workspaceId: ctx.workspaceId, contactId, listId })),
      skipDuplicates: true,
    });
    count += res.count;
  }
  return count;
}

export async function bulkRemoveFromList(
  ctx: TenantContext,
  selection: ContactSelection,
  listId: string,
): Promise<number> {
  requirePermission(ctx, "contacts:write");
  await requireList(ctx, listId);
  const res = await db.contactListMember.deleteMany({
    where: { workspaceId: ctx.workspaceId, listId, contact: await selectionWhere(ctx, selection) },
  });
  return res.count;
}

export async function bulkDelete(
  ctx: TenantContext,
  selection: ContactSelection,
  meta: Partial<RequestMeta> = {},
): Promise<number> {
  requirePermission(ctx, "contacts:delete");
  const res = await db.contact.deleteMany({ where: await selectionWhere(ctx, selection) });
  await audit(
    {
      action: "contacts.bulk_deleted",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Contact",
      metadata: { count: res.count, selection: "ids" in selection ? "ids" : "filter" },
    },
    meta,
  );
  return res.count;
}
