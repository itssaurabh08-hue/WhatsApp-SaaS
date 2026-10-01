import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Audience } from "@/lib/campaigns";
import { segmentDefinitionSchema } from "@/lib/segments";
import { segmentWhere } from "@/server/contacts/where";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";

// Kept free of web-only imports (next/navigation) so the worker can use it.

/** Contacts matching an audience, before opt-in filtering. Always scoped to the workspace. */
export async function audienceWhere(workspaceId: string, audience: Audience): Promise<Prisma.ContactWhereInput> {
  switch (audience.type) {
    case "all":
      return { workspaceId };
    case "list":
      return { workspaceId, lists: { some: { listId: audience.id, workspaceId } } };
    case "tag":
      return { workspaceId, tags: { some: { tagId: audience.id, workspaceId } } };
    case "segment": {
      const segment = await db.segment.findFirst({ where: { id: audience.id, workspaceId } });
      if (!segment) throw new AppError("VALIDATION", { userMessage: "That segment no longer exists." });
      return segmentWhere(workspaceId, segmentDefinitionSchema.parse(segment.definition));
    }
  }
}

/** Opt-in rule: never OPTED_OUT; marketing needs OPTED_IN unless unknown is explicitly allowed. */
export function eligibleOptIn(category: string, includeUnknownOptIn: boolean): Prisma.ContactWhereInput {
  if (category === "MARKETING" && !includeUnknownOptIn) return { optInStatus: "OPTED_IN" };
  return { optInStatus: { not: "OPTED_OUT" } };
}
