import "server-only";
import { db } from "@/server/db/client";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";

export async function listMembers(ctx: TenantContext) {
  requirePermission(ctx, "team:read");
  return db.workspaceMember.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
}
