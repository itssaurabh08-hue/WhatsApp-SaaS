import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { DEFAULT_PLAN_ID } from "@/config/plans";
import { slugify } from "@/lib/slug";
import { RESERVED_SLUGS, SLUG_PATTERN } from "@/lib/validation/workspace";
import { audit } from "@/server/audit/audit";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import type { RequestMeta } from "@/server/request-meta";
import { can, requirePermission, type TenantContext } from "@/server/authz/tenant";

type Meta = Partial<RequestMeta>;

async function slugAvailable(slug: string) {
  if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.has(slug)) return false;
  const existing = await db.workspace.findUnique({ where: { slug }, select: { id: true } });
  return !existing;
}

export async function generateUniqueSlug(name: string): Promise<string> {
  let base = slugify(name);
  if (base.length < 3) base = `${base || "workspace"}-ws`.replace(/^-/, "");
  if (await slugAvailable(base)) return base;
  for (let i = 0; i < 20; i++) {
    const candidate = `${base.slice(0, 40)}-${Math.random().toString(36).slice(2, 7)}`;
    if (await slugAvailable(candidate)) return candidate;
  }
  throw new AppError("INTERNAL", { message: "could not generate unique slug" });
}

/** Creates a workspace and makes the creator its OWNER in one transaction. */
export async function createWorkspace(userId: string, input: { name: string; slug?: string }, meta: Meta = {}) {
  const slug = input.slug ?? (await generateUniqueSlug(input.name));
  try {
    const workspace = await db.workspace.create({
      data: {
        name: input.name,
        slug,
        planId: DEFAULT_PLAN_ID,
        members: { create: { userId, role: "OWNER" } },
      },
      select: { id: true, slug: true, name: true },
    });
    await audit(
      {
        action: "workspace.created",
        workspaceId: workspace.id,
        actorUserId: userId,
        entityType: "Workspace",
        entityId: workspace.id,
      },
      meta,
    );
    return workspace;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", { userMessage: "This workspace URL is already taken. Choose another." });
    }
    throw error;
  }
}

export async function listUserWorkspaces(userId: string) {
  return db.workspaceMember.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { role: true, workspace: { select: { id: true, name: true, slug: true, onboardingStep: true } } },
  });
}

export async function updateBusinessDetails(
  ctx: TenantContext,
  input: { businessName: string; timezone: string; currency: string },
  meta: Meta = {},
) {
  requirePermission(ctx, "workspace:update");
  const updated = await db.workspace.update({
    where: { id: ctx.workspaceId },
    data: {
      businessName: input.businessName,
      timezone: input.timezone,
      currency: input.currency,
      onboardingStep: ctx.workspace.onboardingStep === "BUSINESS" ? "WHATSAPP" : undefined,
    },
    select: { slug: true },
  });
  await audit(
    {
      action: "workspace.settings_updated",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "Workspace",
      entityId: ctx.workspaceId,
      metadata: { fields: ["businessName", "timezone", "currency"] },
    },
    meta,
  );
  return updated;
}

export async function updateWorkspaceSettings(
  ctx: TenantContext,
  input: { name: string; businessName: string; timezone: string; currency: string; logoUrl: string | null },
  meta: Meta = {},
) {
  requirePermission(ctx, "workspace:update");
  const before = ctx.workspace;
  const changed = (Object.keys(input) as (keyof typeof input)[]).filter(
    (key) => (before as Record<string, unknown>)[key] !== input[key],
  );
  await db.workspace.update({ where: { id: ctx.workspaceId }, data: input });
  if (changed.length > 0) {
    await audit(
      {
        action: "workspace.settings_updated",
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user.id,
        entityType: "Workspace",
        entityId: ctx.workspaceId,
        metadata: { fields: changed },
      },
      meta,
    );
  }
}

/** Onboarding steps for later phases can be skipped; this only moves forward. */
const STEP_ORDER = ["BUSINESS", "WHATSAPP", "CONTACTS", "TEMPLATES", "DONE"] as const;
export type OnboardingStepName = (typeof STEP_ORDER)[number];

export async function advanceOnboarding(ctx: TenantContext, to: OnboardingStepName) {
  requirePermission(ctx, "workspace:update");
  const current = STEP_ORDER.indexOf(ctx.workspace.onboardingStep as OnboardingStepName);
  const target = STEP_ORDER.indexOf(to);
  if (target <= current) return;
  await db.workspace.update({ where: { id: ctx.workspaceId }, data: { onboardingStep: to } });
}

export async function getWorkspaceOverview(ctx: TenantContext) {
  requirePermission(ctx, "workspace:read");
  const [memberCount, recentAudit] = await Promise.all([
    db.workspaceMember.count({ where: { workspaceId: ctx.workspaceId } }),
    can(ctx, "audit:read")
      ? db.auditLog.findMany({
          where: { workspaceId: ctx.workspaceId },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, action: true, createdAt: true, actor: { select: { name: true } } },
        })
      : Promise.resolve(null),
  ]);
  return { memberCount, recentAudit };
}
