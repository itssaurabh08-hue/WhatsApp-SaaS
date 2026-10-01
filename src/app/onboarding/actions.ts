"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { createWorkspaceSchema } from "@/lib/validation/workspace";
import { actionError, fieldErrorsFrom, formValues } from "@/server/actions";
import { requireSession } from "@/server/auth/session";
import { getRequestMeta } from "@/server/request-meta";
import { createWorkspace } from "@/server/workspace/service";

type Fields = "name" | "slug";
export async function createWorkspaceAction(
  _prev: ActionState<Fields>,
  formData: FormData,
): Promise<ActionState<Fields>> {
  const session = await requireSession();
  const values = formValues(formData, ["name", "slug"] as const);
  const parsed = createWorkspaceSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error), values };
  let slug: string;
  try {
    const workspace = await createWorkspace(session.user.id, parsed.data, await getRequestMeta());
    slug = workspace.slug;
  } catch (error) {
    return actionError(error, "create-workspace", values);
  }
  redirect(`/w/${slug}/setup`);
}
