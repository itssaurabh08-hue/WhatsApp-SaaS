import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { roleHasPermission, type Permission, type Role } from "@/lib/permissions";
import { requireSession } from "@/server/auth/session";
import type { SessionUser } from "@/server/auth/session-store";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";

export interface TenantContext {
  workspace: {
    id: string;
    name: string;
    slug: string;
    businessName: string | null;
    logoUrl: string | null;
    timezone: string;
    currency: string;
    defaultCountry: string | null;
    planId: string;
    onboardingStep: string;
    isDemo: boolean;
  };
  workspaceId: string;
  user: SessionUser;
  role: Role;
}

/**
 * Loads the workspace for `slug` only if the signed-in user is a member.
 * Returns null (callers render 404) when the workspace does not exist OR the
 * user is not a member, so workspace existence is not leaked.
 */
export async function loadTenantContext(userId: string, slug: string) {
  const membership = await db.workspaceMember.findFirst({
    where: { userId, workspace: { slug } },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          businessName: true,
          logoUrl: true,
          timezone: true,
          currency: true,
          defaultCountry: true,
          planId: true,
          onboardingStep: true,
          isDemo: true,
        },
      },
    },
  });
  return membership;
}

export const getTenantContext = cache(async (slug: string): Promise<TenantContext> => {
  const session = await requireSession();
  const membership = await loadTenantContext(session.user.id, slug);
  if (!membership) notFound();
  return {
    workspace: membership.workspace,
    workspaceId: membership.workspace.id,
    user: session.user,
    role: membership.role,
  };
});

export function can(ctx: Pick<TenantContext, "role">, permission: Permission): boolean {
  return roleHasPermission(ctx.role, permission);
}

export function requirePermission(ctx: Pick<TenantContext, "role">, permission: Permission): void {
  if (!can(ctx, permission)) {
    throw new AppError("FORBIDDEN", { message: `missing permission ${permission}` });
  }
}
