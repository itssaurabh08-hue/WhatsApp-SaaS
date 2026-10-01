import "server-only";
import type { TenantContext } from "@/server/authz/tenant";
import { listCustomFields } from "@/server/contacts/custom-fields";
import { listContactLists } from "@/server/contacts/lists";
import { listTags } from "@/server/contacts/tags";

export async function segmentBuilderOptions(ctx: TenantContext) {
  const [tags, lists, customFields] = await Promise.all([listTags(ctx), listContactLists(ctx), listCustomFields(ctx)]);
  return {
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    lists: lists.map((l) => ({ id: l.id, name: l.name })),
    customFields: customFields.map((f) => ({ key: f.key, label: f.label })),
  };
}
