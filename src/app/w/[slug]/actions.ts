"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { businessSettingsSchema, workspaceSettingsSchema } from "@/lib/validation/workspace";
import { actionError, fieldErrorsFrom, formValues } from "@/server/actions";
import { getTenantContext } from "@/server/authz/tenant";
import { getRequestMeta } from "@/server/request-meta";
import {
  advanceOnboarding,
  updateBusinessDetails,
  updateWorkspaceSettings,
  type OnboardingStepName,
} from "@/server/workspace/service";

type BusinessFields = "businessName" | "timezone" | "currency" | "defaultCountry";
export async function saveBusinessDetailsAction(
  slug: string,
  _prev: ActionState<BusinessFields>,
  formData: FormData,
): Promise<ActionState<BusinessFields>> {
  const ctx = await getTenantContext(slug);
  const values = formValues(formData, ["businessName", "timezone", "currency", "defaultCountry"] as const);
  const parsed = businessSettingsSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error), values };
  try {
    await updateBusinessDetails(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return actionError(error, "save-business-details", values);
  }
  redirect(`/w/${slug}/setup`);
}

const SKIPPABLE: Record<string, OnboardingStepName> = {
  WHATSAPP: "CONTACTS",
  CONTACTS: "TEMPLATES",
  TEMPLATES: "DONE",
};

export async function continueOnboardingAction(slug: string, from: string): Promise<void> {
  const ctx = await getTenantContext(slug);
  const to = SKIPPABLE[from];
  if (to && ctx.workspace.onboardingStep === from) await advanceOnboarding(ctx, to);
  redirect(to === "DONE" ? `/w/${slug}` : `/w/${slug}/setup`);
}

type SettingsFields = "name" | "businessName" | "timezone" | "currency" | "defaultCountry" | "logoUrl";
export async function saveWorkspaceSettingsAction(
  slug: string,
  _prev: ActionState<SettingsFields>,
  formData: FormData,
): Promise<ActionState<SettingsFields>> {
  const ctx = await getTenantContext(slug);
  const values = formValues(formData, [
    "name",
    "businessName",
    "timezone",
    "currency",
    "defaultCountry",
    "logoUrl",
  ] as const);
  const parsed = workspaceSettingsSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error), values };
  try {
    await updateWorkspaceSettings(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return actionError(error, "save-workspace-settings", values);
  }
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Settings saved.", values };
}
