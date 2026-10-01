import "server-only";
import type { Permission } from "@/lib/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { can, loadTenantContext, type TenantContext } from "./tenant";

/**
 * Tenant context for cookie-authenticated route handlers (downloads). Returns
 * a Response to send back when the caller is not allowed. Route handlers here
 * are GET-only and side-effect free apart from audit logging.
 */
export async function routeTenantContext(slug: string, permission: Permission): Promise<TenantContext | Response> {
  const session = await getCurrentSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const membership = await loadTenantContext(session.user.id, slug);
  if (!membership) return new Response("Not found", { status: 404 });
  const ctx: TenantContext = {
    workspace: membership.workspace,
    workspaceId: membership.workspace.id,
    user: session.user,
    role: membership.role,
  };
  if (!can(ctx, permission)) return new Response("Forbidden", { status: 403 });
  return ctx;
}
