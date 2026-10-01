import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { coerceCustomValue } from "@/lib/contacts/custom-values";
import { audit } from "@/server/audit/audit";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import type { RequestMeta } from "@/server/request-meta";

export async function listCustomFields(ctx: TenantContext) {
  requirePermission(ctx, "contacts:read");
  return db.customFieldDefinition.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "asc" },
    select: { id: true, key: true, label: true, type: true },
  });
}

export async function createCustomField(
  ctx: TenantContext,
  input: { key: string; label: string; type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" },
  meta: Partial<RequestMeta> = {},
) {
  requirePermission(ctx, "contacts:manage_fields");
  const count = await db.customFieldDefinition.count({ where: { workspaceId: ctx.workspaceId } });
  if (count >= 50) throw new AppError("VALIDATION", { userMessage: "A workspace can have at most 50 custom fields." });
  try {
    const field = await db.customFieldDefinition.create({ data: { ...input, workspaceId: ctx.workspaceId } });
    await audit(
      {
        action: "custom_field.created",
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user.id,
        entityType: "CustomField",
        entityId: field.id,
        metadata: { key: field.key },
      },
      meta,
    );
    return field;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", { userMessage: "A custom field with this key already exists." });
    }
    throw error;
  }
}

/** Deletes the definition. Stored values remain on contacts but are no longer shown or editable. */
export async function deleteCustomField(ctx: TenantContext, id: string, meta: Partial<RequestMeta> = {}) {
  requirePermission(ctx, "contacts:manage_fields");
  const deleted = await db.customFieldDefinition.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  if (deleted.count === 0) throw new AppError("NOT_FOUND");
  await audit(
    {
      action: "custom_field.deleted",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "CustomField",
      entityId: id,
    },
    meta,
  );
}

/**
 * Validates submitted custom values against the workspace definitions.
 * Unknown keys are rejected; empty values remove the key.
 */
export async function validateCustomValues(
  ctx: TenantContext,
  values: Record<string, string>,
  existing: Record<string, unknown> = {},
): Promise<{ ok: true; value: Record<string, string> } | { ok: false; errors: Record<string, string> }> {
  const definitions = await db.customFieldDefinition.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { key: true, label: true, type: true },
  });
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(existing)) if (typeof v === "string") result[k] = v;
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) {
      errors[key] = "Unknown custom field.";
      continue;
    }
    const coerced = coerceCustomValue(def.type, raw);
    if (!coerced.ok) errors[key] = `${def.label} ${coerced.error}.`;
    else if (coerced.value === null) delete result[key];
    else result[key] = coerced.value;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: result };
}
