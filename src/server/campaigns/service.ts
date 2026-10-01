import "server-only";
import type { CampaignStatus, Prisma } from "@/generated/prisma/client";
import { audienceSchema, variableMappingSchema, type Audience, type VariableMapping } from "@/lib/campaigns";
import { isSendable, templateRequirements, type MetaTemplateComponent } from "@/lib/templates";
import { audit } from "@/server/audit/audit";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import type { RequestMeta } from "@/server/request-meta";
import { audienceWhere } from "./audience";

type Meta = Partial<RequestMeta>;

export interface CampaignInput {
  name: string;
  whatsappAccountId: string;
  templateId: string;
  audience: Audience;
  variableMapping: VariableMapping;
  headerMediaObjectId?: string | null;
  includeUnknownOptIn: boolean;
}

export async function estimateAudience(
  ctx: TenantContext,
  input: { audience: Audience; templateId?: string | null; includeUnknownOptIn: boolean },
) {
  requirePermission(ctx, "campaigns:read");
  const audience = audienceSchema.parse(input.audience);
  const where = await audienceWhere(ctx.workspaceId, audience);
  const template = input.templateId
    ? await db.template.findFirst({
        where: { id: input.templateId, workspaceId: ctx.workspaceId },
        select: { category: true },
      })
    : null;
  const category = template?.category ?? "UTILITY";
  const [total, optedOut, unknown] = await Promise.all([
    db.contact.count({ where }),
    db.contact.count({ where: { workspaceId: ctx.workspaceId, AND: [where, { optInStatus: "OPTED_OUT" }] } }),
    db.contact.count({ where: { workspaceId: ctx.workspaceId, AND: [where, { optInStatus: "UNKNOWN" }] } }),
  ]);
  const unknownExcluded = category === "MARKETING" && !input.includeUnknownOptIn ? unknown : 0;
  return { total, optedOut, unknown, unknownExcluded, eligible: total - optedOut - unknownExcluded, category };
}

async function validateInput(ctx: TenantContext, input: CampaignInput) {
  const name = input.name.trim();
  if (!name || name.length > 120)
    throw new AppError("VALIDATION", { userMessage: "Enter a campaign name (up to 120 characters)." });
  const audience = audienceSchema.parse(input.audience);
  const mapping = variableMappingSchema.parse(input.variableMapping);
  const account = await db.whatsAppAccount.findFirst({
    where: { id: input.whatsappAccountId, workspaceId: ctx.workspaceId },
  });
  if (!account || account.status !== "CONNECTED") {
    throw new AppError("VALIDATION", { userMessage: "Choose a connected WhatsApp number." });
  }
  const template = await db.template.findFirst({ where: { id: input.templateId, workspaceId: ctx.workspaceId } });
  if (!template || template.businessAccountId !== account.businessAccountId) {
    throw new AppError("VALIDATION", {
      userMessage: "Choose a template from this number's WhatsApp Business account.",
    });
  }
  if (!isSendable(template.status))
    throw new AppError("VALIDATION", { userMessage: "Campaigns can only use approved templates." });
  const req = templateRequirements(template.components as unknown as MetaTemplateComponent[]);
  if (req.unsupported) {
    throw new AppError("VALIDATION", {
      userMessage: `This template uses a ${req.unsupported}, which campaigns cannot send yet.`,
    });
  }
  const unmapped = [
    ...req.header.filter((v) => !mapping.header[v]).map((v) => `header {{${v}}}`),
    ...req.body.filter((v) => !mapping.body[v]).map((v) => `{{${v}}}`),
    ...req.buttons.filter((i) => !mapping.buttons[String(i)]).map((i) => `button ${i + 1}`),
  ];
  if (unmapped.length > 0) {
    throw new AppError("VALIDATION", { userMessage: `Choose a value for every variable: ${unmapped.join(", ")}.` });
  }
  if (req.headerMedia) {
    const media = input.headerMediaObjectId
      ? await db.mediaObject.findFirst({
          where: { id: input.headerMediaObjectId, workspaceId: ctx.workspaceId, status: "STORED" },
        })
      : null;
    if (!media)
      throw new AppError("VALIDATION", {
        userMessage: `Upload the ${req.headerMedia.toLowerCase()} for the template header.`,
      });
  }
  if (audience.type !== "all") {
    const exists =
      audience.type === "list"
        ? await db.contactList.count({ where: { id: audience.id, workspaceId: ctx.workspaceId } })
        : audience.type === "tag"
          ? await db.tag.count({ where: { id: audience.id, workspaceId: ctx.workspaceId } })
          : await db.segment.count({ where: { id: audience.id, workspaceId: ctx.workspaceId } });
    if (!exists) throw new AppError("VALIDATION", { userMessage: "The selected audience no longer exists." });
  }
  return { name, audience, mapping, template, account, req };
}

export async function createCampaign(ctx: TenantContext, input: CampaignInput, meta: Meta = {}) {
  requirePermission(ctx, "campaigns:manage");
  const v = await validateInput(ctx, input);
  const campaign = await db.campaign.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: v.name,
      whatsappAccountId: v.account.id,
      templateId: v.template.id,
      audience: v.audience as Prisma.InputJsonValue,
      variableMapping: v.mapping as Prisma.InputJsonValue,
      headerMediaObjectId: v.req.headerMedia ? (input.headerMediaObjectId ?? null) : null,
      includeUnknownOptIn: v.template.category === "MARKETING" ? input.includeUnknownOptIn : false,
      createdById: ctx.user.id,
    },
  });
  await audit(
    {
      action: "campaign.created",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Campaign",
      entityId: campaign.id,
    },
    meta,
  );
  return campaign;
}

async function requireCampaign(ctx: TenantContext, id: string) {
  const campaign = await db.campaign.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!campaign) throw new AppError("NOT_FOUND");
  return campaign;
}

/** Schedules a draft. `scheduledAt` null means send now. */
export async function launchCampaign(ctx: TenantContext, id: string, scheduledAt: Date | null, meta: Meta = {}) {
  requirePermission(ctx, "campaigns:send");
  if (!ctx.user.emailVerifiedAt) {
    throw new AppError("FORBIDDEN", { userMessage: "Verify your email address before sending campaigns." });
  }
  const campaign = await requireCampaign(ctx, id);
  if (campaign.status !== "DRAFT")
    throw new AppError("CONFLICT", { userMessage: "This campaign has already been launched." });
  if (scheduledAt && scheduledAt.getTime() > Date.now() + 90 * 24 * 3600 * 1000) {
    throw new AppError("VALIDATION", { userMessage: "Schedule campaigns at most 90 days ahead." });
  }
  // Re-check everything (template may have been paused, number disconnected) right before launch.
  await validateInput(ctx, {
    name: campaign.name,
    whatsappAccountId: campaign.whatsappAccountId,
    templateId: campaign.templateId ?? "",
    audience: campaign.audience as Audience,
    variableMapping: campaign.variableMapping as VariableMapping,
    headerMediaObjectId: campaign.headerMediaObjectId,
    includeUnknownOptIn: campaign.includeUnknownOptIn,
  });
  const when = scheduledAt && scheduledAt.getTime() > Date.now() ? scheduledAt : new Date();
  const updated = await db.campaign.updateMany({
    where: { id, workspaceId: ctx.workspaceId, status: "DRAFT" },
    data: { status: "SCHEDULED", scheduledAt: when },
  });
  if (updated.count !== 1) throw new AppError("CONFLICT", { userMessage: "This campaign has already been launched." });
  await audit(
    {
      action: "campaign.launched",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Campaign",
      entityId: id,
      metadata: { scheduledAt: when.toISOString() },
    },
    meta,
  );
}

const AUDIT_ACTION = { pause: "campaign.paused", resume: "campaign.resumed", cancel: "campaign.cancelled" } as const;

const TRANSITIONS: Record<"pause" | "resume" | "cancel", { from: CampaignStatus[]; to: CampaignStatus }> = {
  pause: { from: ["SENDING", "SCHEDULED"], to: "PAUSED" },
  resume: { from: ["PAUSED"], to: "SENDING" },
  cancel: { from: ["SCHEDULED", "SENDING", "PAUSED"], to: "CANCELLED" },
};

/**
 * Pause stops handing new recipients to the send queue; resume continues where it
 * stopped; cancel marks every recipient not yet queued as cancelled. Messages already
 * in the send queue (a few seconds' worth, see engine.ts) still go out.
 */
export async function changeCampaignState(
  ctx: TenantContext,
  id: string,
  action: "pause" | "resume" | "cancel",
  meta: Meta = {},
) {
  requirePermission(ctx, "campaigns:send");
  const campaign = await requireCampaign(ctx, id);
  const t = TRANSITIONS[action];
  if (!t.from.includes(campaign.status)) {
    throw new AppError("CONFLICT", {
      userMessage: `A ${campaign.status.toLowerCase()} campaign cannot be ${action}d.`,
    });
  }
  // A paused campaign that never started resumes as scheduled.
  const to = action === "resume" && !campaign.startedAt ? "SCHEDULED" : t.to;
  const updated = await db.campaign.updateMany({
    where: { id, workspaceId: ctx.workspaceId, status: { in: t.from } },
    data: { status: to, ...(action === "cancel" ? { cancelledAt: new Date(), completedAt: new Date() } : {}) },
  });
  if (updated.count !== 1)
    throw new AppError("CONFLICT", { userMessage: "The campaign changed meanwhile. Reload and try again." });
  if (action === "cancel") {
    await db.campaignRecipient.updateMany({
      where: { workspaceId: ctx.workspaceId, campaignId: id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  }
  await audit(
    {
      action: AUDIT_ACTION[action],
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Campaign",
      entityId: id,
    },
    meta,
  );
}

export async function deleteCampaign(ctx: TenantContext, id: string, meta: Meta = {}) {
  requirePermission(ctx, "campaigns:manage");
  const campaign = await requireCampaign(ctx, id);
  if (!["DRAFT", "COMPLETED", "CANCELLED"].includes(campaign.status)) {
    throw new AppError("CONFLICT", { userMessage: "Pause and cancel the campaign before deleting it." });
  }
  await db.campaign.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  await audit(
    {
      action: "campaign.deleted",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Campaign",
      entityId: id,
      metadata: { name: campaign.name },
    },
    meta,
  );
}

export async function listCampaigns(ctx: TenantContext) {
  requirePermission(ctx, "campaigns:read");
  const campaigns = await db.campaign.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      template: { select: { name: true, category: true } },
      whatsappAccount: { select: { displayPhoneNumber: true } },
    },
  });
  const stats = await campaignStatsMany(
    ctx.workspaceId,
    campaigns.map((c) => c.id),
  );
  return campaigns.map((c) => ({ ...c, stats: stats.get(c.id) ?? emptyStats() }));
}

export interface CampaignStats {
  queued: number;
  accepted: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  replied: number;
  pending: number;
  skipped: number;
  cancelled: number;
}

const emptyStats = (): CampaignStats => ({
  queued: 0,
  accepted: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  replied: 0,
  pending: 0,
  skipped: 0,
  cancelled: 0,
});

/**
 * Counts from actual message states (which come from Meta's webhooks).
 * "sent", "delivered" and "read" are cumulative: a read message also counts as
 * delivered and sent. Failed messages are never counted as delivered.
 */
async function campaignStatsMany(workspaceId: string, ids: string[]) {
  const out = new Map<string, CampaignStats>();
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, emptyStats());
  const [byStatus, byRecipient, replies] = await Promise.all([
    db.message.groupBy({
      by: ["campaignId", "status"],
      where: { workspaceId, campaignId: { in: ids } },
      _count: true,
    }),
    db.campaignRecipient.groupBy({
      by: ["campaignId", "status"],
      where: { workspaceId, campaignId: { in: ids }, status: { in: ["PENDING", "SKIPPED", "CANCELLED"] } },
      _count: true,
    }),
    db.campaignRecipient.groupBy({
      by: ["campaignId"],
      where: { workspaceId, campaignId: { in: ids }, repliedAt: { not: null } },
      _count: true,
    }),
  ]);
  for (const row of byStatus) {
    const s = out.get(row.campaignId!)!;
    const n = row._count;
    switch (row.status) {
      case "QUEUED":
      case "SENDING":
        s.queued += n;
        break;
      case "ACCEPTED":
        s.accepted += n;
        break;
      case "SENT":
        s.sent += n;
        break;
      case "DELIVERED":
        s.sent += n;
        s.delivered += n;
        break;
      case "READ":
        s.sent += n;
        s.delivered += n;
        s.read += n;
        break;
      case "FAILED":
        s.failed += n;
        break;
    }
  }
  for (const row of byRecipient) {
    const s = out.get(row.campaignId)!;
    if (row.status === "PENDING") s.pending = row._count;
    if (row.status === "SKIPPED") s.skipped = row._count;
    if (row.status === "CANCELLED") s.cancelled = row._count;
  }
  for (const row of replies) out.get(row.campaignId)!.replied = row._count;
  return out;
}

export async function getCampaign(ctx: TenantContext, id: string) {
  requirePermission(ctx, "campaigns:read");
  const campaign = await db.campaign.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: {
      template: true,
      whatsappAccount: { select: { id: true, displayPhoneNumber: true, messagingLimit: true, status: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!campaign) throw new AppError("NOT_FOUND");
  const stats = (await campaignStatsMany(ctx.workspaceId, [id])).get(id)!;
  return { ...campaign, stats };
}

export type RecipientFilter = "all" | "pending" | "skipped" | "failed" | "delivered" | "read" | "replied";

export async function listRecipients(
  ctx: TenantContext,
  campaignId: string,
  filter: RecipientFilter = "all",
  page = 1,
) {
  requirePermission(ctx, "campaigns:read");
  const where: Prisma.CampaignRecipientWhereInput = { workspaceId: ctx.workspaceId, campaignId };
  if (filter === "pending") where.status = "PENDING";
  if (filter === "skipped") where.status = "SKIPPED";
  if (filter === "failed") where.message = { status: "FAILED" };
  if (filter === "delivered") where.message = { status: { in: ["DELIVERED", "READ"] } };
  if (filter === "read") where.message = { status: "READ" };
  if (filter === "replied") where.repliedAt = { not: null };
  const take = 50;
  const [rows, total] = await Promise.all([
    db.campaignRecipient.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * take,
      take,
      select: {
        id: true,
        status: true,
        skipReason: true,
        repliedAt: true,
        contact: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
        message: { select: { status: true, errorMessage: true, sentAt: true, deliveredAt: true, readAt: true } },
      },
    }),
    db.campaignRecipient.count({ where }),
  ]);
  return { rows, total, pages: Math.max(1, Math.ceil(total / take)) };
}
