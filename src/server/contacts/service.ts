import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { optInTransition } from "@/lib/contacts/custom-values";
import { normalizePhone } from "@/lib/phone";
import { segmentDefinitionSchema, type SegmentDefinition } from "@/lib/segments";
import type { ContactFilter, ContactInput, ContactSort } from "@/lib/validation/contacts";
import { audit } from "@/server/audit/audit";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import type { RequestMeta } from "@/server/request-meta";
import { validateCustomValues } from "./custom-fields";
import { contactFilterWhere } from "./where";

type Meta = Partial<RequestMeta>;

export const CONTACT_PAGE_SIZE = 50;

const listSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phoneNumber: true,
  normalizedPhoneNumber: true,
  email: true,
  company: true,
  optInStatus: true,
  createdAt: true,
  tags: { select: { tag: { select: { id: true, name: true, color: true } } }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.ContactSelect;

const ORDER: Record<ContactSort, Prisma.ContactOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }, { id: "desc" }],
  oldest: [{ createdAt: "asc" }, { id: "asc" }],
  name: [{ firstName: { sort: "asc", nulls: "last" } }, { id: "asc" }],
};

async function loadSegmentDefinition(ctx: TenantContext, segmentId?: string): Promise<SegmentDefinition | null> {
  if (!segmentId) return null;
  const segment = await db.segment.findFirst({
    where: { id: segmentId, workspaceId: ctx.workspaceId },
    select: { definition: true },
  });
  if (!segment) throw new AppError("NOT_FOUND", { userMessage: "That segment no longer exists." });
  return segmentDefinitionSchema.parse(segment.definition);
}

export async function buildContactWhere(ctx: TenantContext, filter: ContactFilter) {
  return contactFilterWhere(ctx.workspaceId, filter, await loadSegmentDefinition(ctx, filter.segmentId));
}

/** Cursor-paginated contacts list. Never loads the whole table. */
export async function listContacts(
  ctx: TenantContext,
  opts: { filter: ContactFilter; sort?: ContactSort; cursor?: string; limit?: number },
) {
  requirePermission(ctx, "contacts:read");
  const limit = Math.min(opts.limit ?? CONTACT_PAGE_SIZE, 200);
  const where = await buildContactWhere(ctx, opts.filter);
  const [rows, total] = await Promise.all([
    db.contact.findMany({
      where,
      orderBy: ORDER[opts.sort ?? "newest"],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: listSelect,
    }),
    db.contact.count({ where }),
  ]);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, total, nextCursor: hasMore ? items.at(-1)!.id : null };
}

export async function getContact(ctx: TenantContext, id: string) {
  requirePermission(ctx, "contacts:read");
  const contact = await db.contact.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: {
      tags: { select: { tag: { select: { id: true, name: true, color: true } } }, orderBy: { createdAt: "asc" } },
      lists: { select: { list: { select: { id: true, name: true } } } },
      notes: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, body: true, createdAt: true, authorId: true, author: { select: { name: true } } },
      },
    },
  });
  if (!contact) throw new AppError("NOT_FOUND", { userMessage: "This contact does not exist." });
  return contact;
}

function phoneOrThrow(input: string, country: string | null, fallback: string | null) {
  const result = normalizePhone(input, country ?? fallback);
  if (!result.ok) throw new AppError("VALIDATION", { userMessage: result.error, details: { field: "phoneNumber" } });
  return result;
}

function duplicateError(existingId?: string) {
  return new AppError("CONFLICT", {
    userMessage: "A contact with this phone number already exists.",
    details: { field: "phoneNumber", existingId },
  });
}

export async function createContact(ctx: TenantContext, input: ContactInput) {
  requirePermission(ctx, "contacts:write");
  const phone = phoneOrThrow(input.phoneNumber, input.country, ctx.workspace.defaultCountry);
  const custom = await validateCustomValues(ctx, input.customFields);
  if (!custom.ok)
    throw new AppError("VALIDATION", {
      userMessage: Object.values(custom.errors)[0],
      details: { customFields: custom.errors },
    });
  const now = new Date();
  try {
    return await db.contact.create({
      data: {
        workspaceId: ctx.workspaceId,
        phoneNumber: input.phoneNumber,
        normalizedPhoneNumber: phone.e164,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        company: input.company,
        country: input.country ?? phone.country,
        optInSource: input.optInSource,
        customFields: custom.value,
        source: "MANUAL",
        ...optInTransition(null, input.optInStatus, now),
      },
      select: { id: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.contact.findFirst({
        where: { workspaceId: ctx.workspaceId, normalizedPhoneNumber: phone.e164 },
        select: { id: true },
      });
      throw duplicateError(existing?.id);
    }
    throw error;
  }
}

export async function updateContact(ctx: TenantContext, id: string, input: ContactInput, meta: Meta = {}) {
  requirePermission(ctx, "contacts:write");
  const existing = await db.contact.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true, optInStatus: true, customFields: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", { userMessage: "This contact does not exist." });
  const phone = phoneOrThrow(input.phoneNumber, input.country, ctx.workspace.defaultCountry);
  const custom = await validateCustomValues(
    ctx,
    input.customFields,
    (existing.customFields ?? {}) as Record<string, unknown>,
  );
  if (!custom.ok)
    throw new AppError("VALIDATION", {
      userMessage: Object.values(custom.errors)[0],
      details: { customFields: custom.errors },
    });
  const optIn = optInTransition(existing.optInStatus, input.optInStatus, new Date());
  try {
    await db.contact.updateMany({
      where: { id, workspaceId: ctx.workspaceId },
      data: {
        phoneNumber: input.phoneNumber,
        normalizedPhoneNumber: phone.e164,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        company: input.company,
        country: input.country ?? phone.country,
        optInSource: input.optInSource,
        customFields: custom.value,
        ...optIn,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw duplicateError();
    throw error;
  }
  if ("optInStatus" in optIn) {
    await audit(
      {
        action: "contact.opt_in_changed",
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user.id,
        entityType: "Contact",
        entityId: id,
        metadata: { from: existing.optInStatus, to: input.optInStatus },
      },
      meta,
    );
  }
}

export async function setOptInStatus(
  ctx: TenantContext,
  id: string,
  status: "UNKNOWN" | "OPTED_IN" | "OPTED_OUT",
  source: string | null,
  meta: Meta = {},
) {
  requirePermission(ctx, "contacts:write");
  const existing = await db.contact.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { optInStatus: true },
  });
  if (!existing) throw new AppError("NOT_FOUND");
  const change = optInTransition(existing.optInStatus, status, new Date());
  if (!("optInStatus" in change)) return;
  await db.contact.updateMany({
    where: { id, workspaceId: ctx.workspaceId },
    data: { ...change, ...(source !== null ? { optInSource: source } : {}) },
  });
  await audit(
    {
      action: "contact.opt_in_changed",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Contact",
      entityId: id,
      metadata: { from: existing.optInStatus, to: status },
    },
    meta,
  );
}

export async function deleteContact(ctx: TenantContext, id: string, meta: Meta = {}) {
  requirePermission(ctx, "contacts:delete");
  const deleted = await db.contact.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  if (deleted.count === 0) throw new AppError("NOT_FOUND");
  await audit(
    {
      action: "contact.deleted",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Contact",
      entityId: id,
    },
    meta,
  );
}

// ---------------------------------------------------------------------------
// Notes (internal only; never sent to the contact)
// ---------------------------------------------------------------------------

export async function addNote(ctx: TenantContext, contactId: string, body: string) {
  requirePermission(ctx, "contacts:write");
  const contact = await db.contact.findFirst({
    where: { id: contactId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!contact) throw new AppError("NOT_FOUND");
  return db.contactNote.create({ data: { workspaceId: ctx.workspaceId, contactId, authorId: ctx.user.id, body } });
}

/** Authors can delete their own notes; admins and owners can delete any note. */
export async function deleteNote(ctx: TenantContext, noteId: string) {
  requirePermission(ctx, "contacts:write");
  const note = await db.contactNote.findFirst({
    where: { id: noteId, workspaceId: ctx.workspaceId },
    select: { authorId: true },
  });
  if (!note) throw new AppError("NOT_FOUND");
  if (note.authorId !== ctx.user.id) requirePermission(ctx, "contacts:delete");
  await db.contactNote.deleteMany({ where: { id: noteId, workspaceId: ctx.workspaceId } });
}
