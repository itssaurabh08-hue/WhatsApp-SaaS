import "server-only";
import type { Prisma, TemplateStatus } from "@/generated/prisma/client";
import { buildComponents, mapMetaTemplateStatus, type TemplateDraft } from "@/lib/templates";
import { audit } from "@/server/audit/audit";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logging/logger";
import { getWhatsAppProvider } from "@/server/providers/whatsapp";
import { MetaApiError } from "@/server/providers/whatsapp/meta/errors";
import type { RequestMeta } from "@/server/request-meta";
import { readCredential } from "@/server/whatsapp/credentials";

type Meta = Partial<RequestMeta>;

export const TEMPLATE_TABS = {
  approved: ["APPROVED"],
  pending: ["PENDING", "IN_APPEAL", "DRAFT"],
  rejected: ["REJECTED"],
  inactive: [
    "PAUSED",
    "DISABLED",
    "FLAGGED",
    "ARCHIVED",
    "LIMIT_EXCEEDED",
    "LOCKED",
    "PENDING_DELETION",
    "DELETED",
    "UNKNOWN",
  ],
} as const satisfies Record<string, TemplateStatus[]>;
export type TemplateTab = keyof typeof TEMPLATE_TABS | "all";

export async function listTemplates(ctx: TenantContext, opts: { tab?: TemplateTab; q?: string } = {}) {
  requirePermission(ctx, "templates:read");
  const where: Prisma.TemplateWhereInput = { workspaceId: ctx.workspaceId };
  if (opts.tab && opts.tab !== "all") where.status = { in: [...TEMPLATE_TABS[opts.tab]] };
  if (opts.q) where.name = { contains: opts.q.toLowerCase() };
  const [templates, counts] = await Promise.all([
    db.template.findMany({ where, orderBy: [{ updatedAt: "desc" }], take: 500 }),
    db.template.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId }, _count: true }),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const tabCounts = Object.fromEntries(
    Object.entries(TEMPLATE_TABS).map(([tab, statuses]) => [
      tab,
      statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0),
    ]),
  ) as Record<keyof typeof TEMPLATE_TABS, number>;
  return { templates, tabCounts };
}

export async function getTemplate(ctx: TenantContext, id: string) {
  requirePermission(ctx, "templates:read");
  const template = await db.template.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!template) throw new AppError("NOT_FOUND");
  return template;
}

/** Approved templates usable from a given number (same WhatsApp Business Account). */
export async function listSendableTemplates(ctx: TenantContext, whatsappAccountId: string) {
  requirePermission(ctx, "templates:read");
  const account = await db.whatsAppAccount.findFirst({
    where: { id: whatsappAccountId, workspaceId: ctx.workspaceId },
    select: { businessAccountId: true },
  });
  if (!account) return [];
  return db.template.findMany({
    where: { workspaceId: ctx.workspaceId, businessAccountId: account.businessAccountId, status: "APPROVED" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, language: true, category: true, parameterFormat: true, components: true },
  });
}

async function connectedAccount(ctx: TenantContext, whatsappAccountId: string) {
  const account = await db.whatsAppAccount.findFirst({
    where: { id: whatsappAccountId, workspaceId: ctx.workspaceId },
  });
  if (!account) throw new AppError("NOT_FOUND");
  if (account.status !== "CONNECTED" || !account.accessTokenRef) {
    throw new AppError("VALIDATION", { userMessage: "Connect this WhatsApp number first (Settings > WhatsApp)." });
  }
  const token = await readCredential(ctx.workspaceId, account.accessTokenRef);
  return { account, token, callCtx: { workspaceId: ctx.workspaceId, whatsappAccountId: account.id } };
}

function metaToUserError(error: unknown, fallback: string): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof MetaApiError) {
    // Template validation messages from Meta (e.g. "Content in This Language Already Exists")
    // explain what to fix and contain no secrets.
    const detail = error.info.category === "invalid_request" && error.metaMessage ? ` (${error.metaMessage})` : "";
    return new AppError("VALIDATION", {
      message: error.message,
      userMessage: `${error.info.userMessage}${detail}`.slice(0, 500),
      cause: error,
    });
  }
  logger.error({ err: error }, "template operation failed");
  return new AppError("INTERNAL", { message: String(error), userMessage: fallback, cause: error });
}

/** Submits a new template to Meta for review and stores it. */
export async function createTemplate(ctx: TenantContext, draft: TemplateDraft, meta: Meta = {}) {
  requirePermission(ctx, "templates:manage");
  const { account, token, callCtx } = await connectedAccount(ctx, draft.whatsappAccountId);
  const duplicate = await db.template.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      businessAccountId: account.businessAccountId,
      name: draft.name,
      language: draft.language,
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new AppError("CONFLICT", { userMessage: "A template with this name and language already exists." });
  }
  const components = buildComponents(draft);
  let created: { id: string; status: string; category: string | null };
  try {
    created = await getWhatsAppProvider().createTemplate(
      account.businessAccountId,
      {
        name: draft.name,
        language: draft.language,
        category: draft.category,
        parameterFormat: draft.parameterFormat,
        components,
      },
      token,
      { ...callCtx, requestId: meta.requestId ?? null },
    );
  } catch (error) {
    throw metaToUserError(error, "Submitting the template failed. Try again.");
  }
  const category = (created.category ?? draft.category).toUpperCase();
  const template = await db.template.create({
    data: {
      workspaceId: ctx.workspaceId,
      businessAccountId: account.businessAccountId,
      providerTemplateId: created.id,
      name: draft.name,
      language: draft.language,
      // Meta may recategorize a template; keep what Meta says.
      category: (["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category) ? category : draft.category) as never,
      status: mapMetaTemplateStatus(created.status) as TemplateStatus,
      parameterFormat: draft.parameterFormat,
      components: components as unknown as Prisma.InputJsonValue,
      createdById: ctx.user.id,
      lastSyncedAt: new Date(),
    },
  });
  await audit(
    {
      action: "template.created",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Template",
      entityId: template.id,
      metadata: { name: template.name, language: template.language, category: template.category },
    },
    meta,
  );
  return template;
}

/**
 * Imports every template of the number's WhatsApp Business Account from Meta,
 * including ones created in WhatsApp Manager. Templates no longer returned by
 * Meta are marked DELETED.
 */
export async function syncTemplates(ctx: TenantContext, whatsappAccountId: string, meta: Meta = {}) {
  requirePermission(ctx, "templates:manage");
  const { account, token, callCtx } = await connectedAccount(ctx, whatsappAccountId);
  let remote;
  try {
    remote = await getWhatsAppProvider().listTemplates(account.businessAccountId, token, {
      ...callCtx,
      requestId: meta.requestId ?? null,
    });
  } catch (error) {
    throw metaToUserError(error, "Could not load templates from WhatsApp. Try again.");
  }
  const now = new Date();
  for (const t of remote) {
    const category = t.category.toUpperCase();
    const data = {
      providerTemplateId: t.id,
      category: (["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category) ? category : "UTILITY") as never,
      status: mapMetaTemplateStatus(t.status) as TemplateStatus,
      parameterFormat: t.parameterFormat,
      components: t.components as unknown as Prisma.InputJsonValue,
      rejectionReason: t.rejectionReason,
      lastSyncedAt: now,
    };
    await db.template.upsert({
      where: {
        workspaceId_businessAccountId_name_language: {
          workspaceId: ctx.workspaceId,
          businessAccountId: account.businessAccountId,
          name: t.name,
          language: t.language,
        },
      },
      create: {
        ...data,
        workspaceId: ctx.workspaceId,
        businessAccountId: account.businessAccountId,
        name: t.name,
        language: t.language,
      },
      update: data,
    });
  }
  const gone = await db.template.updateMany({
    where: {
      workspaceId: ctx.workspaceId,
      businessAccountId: account.businessAccountId,
      providerTemplateId: { notIn: remote.map((t) => t.id) },
      status: { not: "DRAFT" },
    },
    data: { status: "DELETED", lastSyncedAt: now },
  });
  await audit(
    {
      action: "templates.synced",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      metadata: { count: remote.length, markedDeleted: gone.count },
    },
    meta,
  );
  return { count: remote.length, markedDeleted: gone.count };
}

/** Deletes the template in Meta (this language only) and here. */
export async function deleteTemplate(ctx: TenantContext, id: string, meta: Meta = {}) {
  requirePermission(ctx, "templates:manage");
  const template = await db.template.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!template) throw new AppError("NOT_FOUND");
  if (template.providerTemplateId && template.status !== "DELETED") {
    const account = await db.whatsAppAccount.findFirst({
      where: { workspaceId: ctx.workspaceId, businessAccountId: template.businessAccountId, status: "CONNECTED" },
      select: { id: true },
    });
    if (!account) {
      throw new AppError("VALIDATION", {
        userMessage: "Connect a number from this WhatsApp Business account to delete the template in WhatsApp.",
      });
    }
    const { token, callCtx } = await connectedAccount(ctx, account.id);
    try {
      await getWhatsAppProvider().deleteTemplate(
        template.businessAccountId,
        template.name,
        template.providerTemplateId,
        token,
        { ...callCtx, requestId: meta.requestId ?? null },
      );
    } catch (error) {
      throw metaToUserError(error, "Deleting the template in WhatsApp failed. Try again.");
    }
  }
  await db.template.deleteMany({ where: { id: template.id, workspaceId: ctx.workspaceId } });
  await audit(
    {
      action: "template.deleted",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Template",
      entityId: template.id,
      metadata: { name: template.name, language: template.language },
    },
    meta,
  );
}
