"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audienceSchema, variableMappingSchema, zonedLocalToUtc } from "@/lib/campaigns";
import { actionError } from "@/server/actions";
import { getTenantContext, requirePermission } from "@/server/authz/tenant";
import {
  changeCampaignState,
  createCampaign,
  deleteCampaign,
  estimateAudience,
  launchCampaign,
} from "@/server/campaigns/service";
import { AppError } from "@/server/errors";
import { storeUpload } from "@/server/messaging/media";
import { getRequestMeta } from "@/server/request-meta";

type Result = { ok: boolean; message?: string };
const base = (slug: string) => `/w/${slug}/campaigns`;

function parseJson(formData: FormData, key: string): unknown {
  try {
    return JSON.parse(String(formData.get(key) ?? "null"));
  } catch {
    throw new AppError("VALIDATION", { userMessage: "The form could not be read. Reload and try again." });
  }
}

export async function estimateAction(slug: string, formData: FormData) {
  const ctx = await getTenantContext(slug);
  try {
    const audience = audienceSchema.parse(parseJson(formData, "audience"));
    const r = await estimateAudience(ctx, {
      audience,
      templateId: String(formData.get("templateId") ?? "") || null,
      includeUnknownOptIn: formData.get("includeUnknownOptIn") === "true",
    });
    return { ok: true, ...r };
  } catch (error) {
    return { ok: false, message: actionError(error, "estimate-audience").message };
  }
}

export async function createCampaignAction(slug: string, formData: FormData): Promise<Result> {
  const ctx = await getTenantContext(slug);
  let id: string;
  try {
    requirePermission(ctx, "campaigns:manage");
    let headerMediaObjectId: string | null = null;
    const file = formData.get("headerFile");
    if (file instanceof File && file.size > 0) {
      const media = await storeUpload(ctx.workspaceId, ctx.user.id, {
        name: file.name,
        type: file.type,
        data: new Uint8Array(await file.arrayBuffer()),
      });
      headerMediaObjectId = media.id;
    }
    const audience = audienceSchema.safeParse(parseJson(formData, "audience"));
    const mapping = variableMappingSchema.safeParse(parseJson(formData, "mapping"));
    if (!audience.success) return { ok: false, message: "Choose who should receive the campaign." };
    if (!mapping.success) return { ok: false, message: "Check the variable values." };
    const campaign = await createCampaign(
      ctx,
      {
        name: String(formData.get("name") ?? ""),
        whatsappAccountId: String(formData.get("whatsappAccountId") ?? ""),
        templateId: String(formData.get("templateId") ?? ""),
        audience: audience.data,
        variableMapping: mapping.data,
        headerMediaObjectId,
        includeUnknownOptIn: formData.get("includeUnknownOptIn") === "true",
      },
      await getRequestMeta(),
    );
    id = campaign.id;
  } catch (error) {
    return { ok: false, message: actionError(error, "create-campaign").message };
  }
  revalidatePath(base(slug));
  redirect(`${base(slug)}/${id}`);
}

export async function launchAction(slug: string, id: string, formData: FormData): Promise<Result> {
  const ctx = await getTenantContext(slug);
  try {
    const when = String(formData.get("scheduledAt") ?? "");
    let scheduledAt: Date | null = null;
    if (when) {
      scheduledAt = zonedLocalToUtc(when, ctx.workspace.timezone);
      if (!scheduledAt) return { ok: false, message: "Enter a valid date and time." };
      if (scheduledAt.getTime() < Date.now() - 60_000) return { ok: false, message: "Choose a time in the future." };
    }
    await launchCampaign(ctx, id, scheduledAt, await getRequestMeta());
  } catch (error) {
    return { ok: false, message: actionError(error, "launch-campaign").message };
  }
  revalidatePath(base(slug));
  return { ok: true, message: "Campaign launched." };
}

export async function stateAction(slug: string, id: string, action: "pause" | "resume" | "cancel"): Promise<Result> {
  const ctx = await getTenantContext(slug);
  try {
    await changeCampaignState(ctx, id, action, await getRequestMeta());
  } catch (error) {
    return { ok: false, message: actionError(error, "campaign-state").message };
  }
  revalidatePath(base(slug));
  return {
    ok: true,
    message: { pause: "Campaign paused.", resume: "Campaign resumed.", cancel: "Campaign cancelled." }[action],
  };
}

export async function deleteCampaignAction(slug: string, id: string): Promise<Result> {
  const ctx = await getTenantContext(slug);
  try {
    await deleteCampaign(ctx, id, await getRequestMeta());
  } catch (error) {
    return { ok: false, message: actionError(error, "delete-campaign").message };
  }
  revalidatePath(base(slug));
  redirect(base(slug));
}
