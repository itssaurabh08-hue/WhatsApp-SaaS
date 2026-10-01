"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError } from "@/server/actions";
import { getTenantContext, requirePermission } from "@/server/authz/tenant";
import { AppError } from "@/server/errors";
import {
  addConversationNote,
  assignConversation,
  sendReply,
  setConversationStatus,
  startConversation,
} from "@/server/inbox/service";
import { storeUpload } from "@/server/messaging/media";
import type { OutboundRequest } from "@/server/messaging/outbound";
import { getRequestMeta } from "@/server/request-meta";

export type InboxResult = { ok: boolean; message?: string };

const path = (slug: string) => `/w/${slug}/inbox`;
const idSchema = z.string().min(1).max(64);
const valuesSchema = z.object({
  header: z.record(z.string(), z.string().max(1024)).optional(),
  body: z.record(z.string(), z.string().max(1024)).optional(),
  buttons: z.record(z.string(), z.string().max(2000)).optional(),
});

async function uploadFrom(slug: string, file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) return null;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "inbox:reply");
  const media = await storeUpload(ctx.workspaceId, ctx.user.id, {
    name: file.name,
    type: file.type,
    data: new Uint8Array(await file.arrayBuffer()),
  });
  return media.id;
}

function templateRequest(formData: FormData, headerMediaObjectId: string | null): OutboundRequest {
  const templateId = idSchema.parse(formData.get("templateId"));
  let values: unknown = {};
  try {
    values = JSON.parse(String(formData.get("values") ?? "{}"));
  } catch {
    throw new AppError("VALIDATION", { userMessage: "The template values could not be read." });
  }
  const parsed = valuesSchema.safeParse(values);
  if (!parsed.success) throw new AppError("VALIDATION", { userMessage: "A template value is too long." });
  return { kind: "template", templateId, values: parsed.data, headerMediaObjectId };
}

/** Text, file or template reply in a conversation (kind = text | media | template). */
export async function sendReplyAction(slug: string, conversationId: string, formData: FormData): Promise<InboxResult> {
  const ctx = await getTenantContext(slug);
  try {
    const kind = String(formData.get("kind"));
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "").slice(0, 64) || null;
    const replyToMessageId = String(formData.get("replyTo") ?? "") || null;
    let request: OutboundRequest;
    if (kind === "text") {
      request = { kind: "text", text: String(formData.get("text") ?? "") };
    } else if (kind === "media") {
      const mediaObjectId = await uploadFrom(slug, formData.get("file"));
      if (!mediaObjectId) return { ok: false, message: "Choose a file to send." };
      request = { kind: "media", mediaObjectId, caption: String(formData.get("text") ?? "") };
    } else if (kind === "template") {
      request = templateRequest(formData, await uploadFrom(slug, formData.get("headerFile")));
    } else {
      return { ok: false, message: "Unknown message type." };
    }
    await sendReply(ctx, { conversationId, request, idempotencyKey, replyToMessageId });
  } catch (error) {
    return { ok: false, message: actionError(error, "send-reply").message };
  }
  revalidatePath(path(slug));
  return { ok: true };
}

/** First template message to a contact (from the contact page or "New conversation"). */
export async function startConversationAction(slug: string, formData: FormData): Promise<InboxResult> {
  const ctx = await getTenantContext(slug);
  let conversationId: string;
  try {
    const contactId = idSchema.parse(formData.get("contactId"));
    const whatsappAccountId = idSchema.parse(formData.get("whatsappAccountId"));
    const request = templateRequest(formData, await uploadFrom(slug, formData.get("headerFile")));
    if (request.kind !== "template") throw new AppError("VALIDATION");
    const message = await startConversation(ctx, {
      contactId,
      whatsappAccountId,
      request,
      idempotencyKey: String(formData.get("idempotencyKey") ?? "").slice(0, 64) || null,
    });
    conversationId = message.conversationId;
  } catch (error) {
    return { ok: false, message: actionError(error, "start-conversation").message };
  }
  revalidatePath(path(slug));
  redirect(`${path(slug)}?c=${conversationId}`);
}

export async function addNoteAction(slug: string, conversationId: string, formData: FormData): Promise<InboxResult> {
  const ctx = await getTenantContext(slug);
  try {
    await addConversationNote(ctx, conversationId, String(formData.get("note") ?? ""));
  } catch (error) {
    return { ok: false, message: actionError(error, "add-note").message };
  }
  revalidatePath(path(slug));
  return { ok: true, message: "Note added. Only your team can see it." };
}

export async function assignAction(slug: string, conversationId: string, formData: FormData): Promise<InboxResult> {
  const ctx = await getTenantContext(slug);
  try {
    const userId = String(formData.get("userId") ?? "") || null;
    await assignConversation(ctx, conversationId, userId, await getRequestMeta());
  } catch (error) {
    return { ok: false, message: actionError(error, "assign").message };
  }
  revalidatePath(path(slug));
  return { ok: true, message: "Assignment updated." };
}

const statusSchema = z.enum(["OPEN", "PENDING", "CLOSED"]);

export async function setStatusAction(slug: string, conversationId: string, status: string): Promise<InboxResult> {
  const ctx = await getTenantContext(slug);
  try {
    await setConversationStatus(ctx, conversationId, statusSchema.parse(status), await getRequestMeta());
  } catch (error) {
    return { ok: false, message: actionError(error, "set-status").message };
  }
  revalidatePath(path(slug));
  return { ok: true, message: status === "CLOSED" ? "Conversation closed." : "Conversation updated." };
}
