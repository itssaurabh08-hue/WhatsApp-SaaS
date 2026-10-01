"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { templateDraftSchema } from "@/lib/templates";
import { actionError } from "@/server/actions";
import { getTenantContext } from "@/server/authz/tenant";
import { getRequestMeta } from "@/server/request-meta";
import { createTemplate, deleteTemplate, syncTemplates } from "@/server/templates/service";

const base = (slug: string) => `/w/${slug}/templates`;

export type TemplateFormState = ActionState & { errors?: Record<string, string> };

/** The editor posts the whole draft as JSON in a "draft" field. */
export async function createTemplateAction(
  slug: string,
  _prev: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  const ctx = await getTenantContext(slug);
  let input: unknown;
  try {
    input = JSON.parse(String(formData.get("draft") ?? "{}"));
  } catch {
    return { ok: false, message: "The form could not be read. Reload the page and try again." };
  }
  const parsed = templateDraftSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (!(key in errors)) errors[key] = issue.message;
    }
    return { ok: false, message: "Check the highlighted fields.", errors };
  }
  let id: string;
  try {
    id = (await createTemplate(ctx, parsed.data, await getRequestMeta())).id;
  } catch (error) {
    return actionError(error, "create-template");
  }
  revalidatePath(base(slug));
  redirect(`${base(slug)}/${id}?created=1`);
}

export async function syncTemplatesAction(slug: string, formData: FormData) {
  const ctx = await getTenantContext(slug);
  const accountId = String(formData.get("whatsappAccountId") ?? "");
  try {
    const r = await syncTemplates(ctx, accountId, await getRequestMeta());
    revalidatePath(base(slug));
    return { ok: true, message: `Loaded ${r.count} template${r.count === 1 ? "" : "s"} from WhatsApp.` };
  } catch (error) {
    return { ok: false, message: actionError(error, "sync-templates").message };
  }
}

export async function deleteTemplateAction(slug: string, id: string) {
  const ctx = await getTenantContext(slug);
  try {
    await deleteTemplate(ctx, id, await getRequestMeta());
  } catch (error) {
    return { ok: false, message: actionError(error, "delete-template").message };
  }
  revalidatePath(base(slug));
  redirect(base(slug));
}
