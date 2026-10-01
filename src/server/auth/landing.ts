import "server-only";
import { db } from "@/server/db/client";

/** Where a signed-in user should land when no explicit destination is given. */
export async function defaultLandingPath(userId: string): Promise<string> {
  const first = await db.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspace: { select: { slug: true } } },
  });
  return first ? `/w/${first.workspace.slug}` : "/onboarding";
}
