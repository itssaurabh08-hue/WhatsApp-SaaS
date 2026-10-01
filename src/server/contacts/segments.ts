import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { segmentDefinitionSchema, type SegmentDefinition } from "@/lib/segments";
import { audit } from "@/server/audit/audit";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import type { RequestMeta } from "@/server/request-meta";
import { segmentWhere } from "./where";

type Meta = Partial<RequestMeta>;

function conflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AppError("CONFLICT", { userMessage: "A segment with this name already exists." });
  }
  throw error;
}

export async function listSegments(ctx: TenantContext) {
  requirePermission(ctx, "contacts:read");
  return db.segment.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, definition: true, updatedAt: true },
  });
}

export async function getSegment(ctx: TenantContext, id: string) {
  requirePermission(ctx, "contacts:read");
  const segment = await db.segment.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!segment) throw new AppError("NOT_FOUND", { userMessage: "This segment does not exist." });
  return { ...segment, definition: segmentDefinitionSchema.parse(segment.definition) };
}

/** Number of contacts that currently match a definition (used for previews). */
export async function countSegment(ctx: TenantContext, definition: SegmentDefinition) {
  requirePermission(ctx, "contacts:read");
  return db.contact.count({ where: segmentWhere(ctx.workspaceId, definition) });
}

export async function createSegment(
  ctx: TenantContext,
  input: { name: string; description: string | null; definition: SegmentDefinition },
  meta: Meta = {},
) {
  requirePermission(ctx, "segments:manage");
  try {
    const segment = await db.segment.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        description: input.description,
        definition: input.definition,
      },
      select: { id: true },
    });
    await audit(
      {
        action: "segment.created",
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user.id,
        entityType: "Segment",
        entityId: segment.id,
      },
      meta,
    );
    return segment;
  } catch (error) {
    conflict(error);
  }
}

export async function updateSegment(
  ctx: TenantContext,
  id: string,
  input: { name: string; description: string | null; definition: SegmentDefinition },
  meta: Meta = {},
) {
  requirePermission(ctx, "segments:manage");
  try {
    const res = await db.segment.updateMany({
      where: { id, workspaceId: ctx.workspaceId },
      data: { name: input.name, description: input.description, definition: input.definition },
    });
    if (res.count === 0) throw new AppError("NOT_FOUND");
  } catch (error) {
    conflict(error);
  }
  await audit(
    {
      action: "segment.updated",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Segment",
      entityId: id,
    },
    meta,
  );
}

export async function deleteSegment(ctx: TenantContext, id: string, meta: Meta = {}) {
  requirePermission(ctx, "segments:manage");
  const res = await db.segment.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  if (res.count === 0) throw new AppError("NOT_FOUND");
  await audit(
    {
      action: "segment.deleted",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Segment",
      entityId: id,
    },
    meta,
  );
}
