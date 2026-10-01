import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { messagePreview, STATUS_RANK } from "@/lib/messaging";
import { mapMetaTemplateStatus } from "@/lib/templates";
import { attributeReply } from "@/server/campaigns/engine";
import { db } from "@/server/db/client";
import { logger } from "@/server/logging/logger";
import { getWhatsAppProvider } from "@/server/providers/whatsapp";
import { classifyMetaError } from "@/server/providers/whatsapp/meta/errors";
import { enqueueMediaDownloads } from "@/server/queue/queues";
import { readCredential } from "@/server/whatsapp/credentials";

/**
 * Handlers for the `messages` and `message_template_status_update` webhook
 * fields. Payload shapes: WA/webhooks/reference/messages/* and
 * WA/webhooks/reference/message_template_status_update (see docs/META_API_VERIFICATION.md).
 * Each handler is idempotent: a replayed event changes nothing.
 */

export interface StoredPayload {
  businessAccountId: string | null;
  phoneNumberId: string | null;
  value: Record<string, unknown>;
}

export type HandlerOutcome = { status: "PROCESSED" | "IGNORED"; note?: string };

const MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function toDate(unixSeconds: unknown, fallback = new Date()): Date {
  const n = Number(unixSeconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : fallback;
}

/** Text shown in the inbox for each incoming type, plus details worth keeping. */
function describeInbound(m: Obj): { type: string; body: string | null; payload: Obj | null } {
  const type = str(m.type) ?? "unsupported";
  const content = obj(m[type]);
  switch (type) {
    case "text":
      return { type, body: str(content.body), payload: null };
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
      return { type, body: str(content.caption), payload: null };
    case "location": {
      const parts = [str(content.name), str(content.address)].filter(Boolean).join(", ");
      const coords = `${content.latitude ?? "?"}, ${content.longitude ?? "?"}`;
      return {
        type,
        body: parts ? `${parts} (${coords})` : `Location: ${coords}`,
        payload: {
          latitude: content.latitude ?? null,
          longitude: content.longitude ?? null,
          name: content.name ?? null,
          address: content.address ?? null,
          url: content.url ?? null,
        },
      };
    }
    case "interactive": {
      const reply = obj(content.button_reply ?? content.list_reply);
      return {
        type,
        body: str(reply.title),
        payload: { replyType: content.type ?? null, id: reply.id ?? null, description: reply.description ?? null },
      };
    }
    case "button":
      return { type, body: str(content.text), payload: { payload: content.payload ?? null } };
    case "reaction":
      return {
        type,
        body: str(content.emoji),
        payload: { reactedTo: content.message_id ?? null, removed: !content.emoji },
      };
    case "contacts": {
      const list = Array.isArray(m.contacts) ? (m.contacts as Obj[]) : [];
      const names = list.map((c) => str(obj(c.name).formatted_name)).filter(Boolean);
      return {
        type,
        body: names.length > 0 ? `Shared contact: ${names.join(", ")}` : "Shared contact",
        payload: { contacts: list as Prisma.InputJsonValue } as Obj,
      };
    }
    default:
      return { type: "unsupported", body: null, payload: { originalType: type } };
  }
}

/** One incoming customer message: contact, conversation, message, media download. */
async function handleIncomingMessage(workspaceId: string, account: { id: string }, value: Obj, m: Obj) {
  const wamid = str(m.id);
  const from = str(m.from);
  if (!wamid || !from) return { status: "IGNORED", note: "message without id or sender" } as HandlerOutcome;

  const existing = await db.message.findFirst({
    where: { workspaceId, whatsappMessageId: wamid },
    select: { id: true },
  });
  if (existing) return { status: "PROCESSED", note: "duplicate" } as HandlerOutcome;

  const phone = `+${from.replace(/\D/g, "")}`;
  const profiles = Array.isArray(value.contacts) ? (value.contacts as Obj[]) : [];
  const profile = profiles.find((c) => c.wa_id === from) ?? profiles[0];
  const profileName = str(obj(profile?.profile).name)?.slice(0, 100) ?? null;

  const contact = await db.contact.upsert({
    where: { workspaceId_normalizedPhoneNumber: { workspaceId, normalizedPhoneNumber: phone } },
    create: {
      workspaceId,
      phoneNumber: phone,
      normalizedPhoneNumber: phone,
      firstName: profileName,
      source: "INBOUND",
    },
    update: {},
    select: { id: true },
  });
  const conversation = await db.conversation.upsert({
    where: {
      workspaceId_contactId_whatsappAccountId: { workspaceId, contactId: contact.id, whatsappAccountId: account.id },
    },
    create: { workspaceId, contactId: contact.id, whatsappAccountId: account.id },
    update: {},
    select: { id: true },
  });

  const receivedAt = toDate(m.timestamp);
  const { type, body, payload } = describeInbound(m);
  let mediaObjectId: string | null = null;
  if (MEDIA_TYPES.has(type)) {
    const content = obj(m[type]);
    const providerMediaId = str(content.id);
    if (providerMediaId) {
      const media = await db.mediaObject.create({
        data: {
          workspaceId,
          mimeType: str(content.mime_type) ?? "application/octet-stream",
          fileName: str(content.filename)?.slice(0, 200) ?? null,
          sha256: str(content.sha256),
          providerMediaId,
          status: "PENDING",
        },
        select: { id: true },
      });
      mediaObjectId = media.id;
    }
  }

  try {
    await db.message.create({
      data: {
        workspaceId,
        conversationId: conversation.id,
        contactId: contact.id,
        whatsappAccountId: account.id,
        direction: "INBOUND",
        type,
        body,
        mediaObjectId,
        payload: payload ? (payload as Prisma.InputJsonValue) : Prisma.JsonNull,
        contextMessageId: str(obj(m.context).id),
        whatsappMessageId: wamid,
        status: "RECEIVED",
        receivedAt,
        events: { create: { workspaceId, type: "RECEIVED", occurredAt: receivedAt } },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "PROCESSED", note: "duplicate" } as HandlerOutcome;
    }
    throw error;
  }

  // Window and ordering fields only move forward, so out-of-order webhooks are safe.
  await db.conversation.updateMany({
    where: { id: conversation.id, workspaceId },
    data: { unreadCount: { increment: 1 }, status: "OPEN" },
  });
  await db.conversation.updateMany({
    where: { id: conversation.id, workspaceId, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: receivedAt } }] },
    data: { lastInboundAt: receivedAt },
  });
  await db.conversation.updateMany({
    where: { id: conversation.id, workspaceId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: receivedAt } }] },
    data: { lastMessageAt: receivedAt, lastMessagePreview: messagePreview(type, body) },
  });
  await db.contact.updateMany({
    where: { id: contact.id, workspaceId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: receivedAt } }] },
    data: { lastMessageAt: receivedAt },
  });
  await attributeReply(workspaceId, contact.id, account.id, receivedAt);
  if (mediaObjectId) {
    await enqueueMediaDownloads([{ mediaObjectId, workspaceId, whatsappAccountId: account.id }]);
  }
  return { status: "PROCESSED" } as HandlerOutcome;
}

const STATUS_MAP: Record<string, string> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  played: "READ",
  failed: "FAILED",
};

/**
 * Applies a status webhook to our message. Statuses only move forward
 * (Meta may deliver them out of order); "read" implies "delivered" (Meta
 * omits the delivered webhook in that case). Messages are matched by wamid,
 * or by our id echoed in biz_opaque_callback_data.
 */
async function handleStatus(workspaceId: string, s: Obj): Promise<HandlerOutcome> {
  const wamid = str(s.id);
  const raw = str(s.status) ?? "";
  const target = STATUS_MAP[raw];
  if (!wamid || !target) return { status: "IGNORED", note: `unknown status ${raw}` };
  const callback = str(s.biz_opaque_callback_data);

  let message = await db.message.findFirst({
    where: { workspaceId, whatsappMessageId: wamid },
    select: { id: true, status: true, whatsappMessageId: true },
  });
  if (!message && callback) {
    message = await db.message.findFirst({
      where: { workspaceId, id: callback, direction: "OUTBOUND" },
      select: { id: true, status: true, whatsappMessageId: true },
    });
  }
  if (!message) return { status: "IGNORED", note: "message not sent from this app" };

  const at = toDate(s.timestamp);
  const errors = Array.isArray(s.errors) ? (s.errors as Obj[]) : [];
  const err = obj(errors[0]);
  const pricing = s.pricing ? (s.pricing as Prisma.InputJsonValue) : undefined;
  const eventType = raw === "played" ? "PLAYED" : target;

  const events: Prisma.MessageEventCreateManyInput[] = [];
  // "read" implies "delivered" (WA/webhooks/reference/messages/status).
  if (target === "READ") events.push({ workspaceId, messageId: message.id, type: "DELIVERED", occurredAt: at });
  events.push({
    workspaceId,
    messageId: message.id,
    type: eventType,
    occurredAt: at,
    errorCode: typeof err.code === "number" ? err.code : null,
    errorTitle: str(err.title)?.slice(0, 200) ?? null,
    pricing,
  });
  await db.messageEvent.createMany({ data: events, skipDuplicates: true });

  const wamidPatch = message.whatsappMessageId ? {} : { whatsappMessageId: wamid };
  if (target === "FAILED") {
    const code = typeof err.code === "number" ? err.code : null;
    // A failure never overrides a confirmed delivery or read.
    await db.message.updateMany({
      where: { id: message.id, workspaceId, status: { notIn: ["DELIVERED", "READ", "FAILED"] } },
      data: {
        ...wamidPatch,
        status: "FAILED",
        failedAt: at,
        errorCode: code,
        errorMessage: classifyMetaError(code).userMessage,
      },
    });
    return { status: "PROCESSED" };
  }

  const lower = Object.entries(STATUS_RANK)
    .filter(([, rank]) => rank < STATUS_RANK[target]!)
    .map(([name]) => name) as ("QUEUED" | "SENDING" | "ACCEPTED" | "SENT" | "DELIVERED")[];
  const stamps: Prisma.MessageUpdateManyMutationInput = {};
  if (target === "SENT") stamps.sentAt = at;
  if (target === "DELIVERED") stamps.deliveredAt = at;
  if (target === "READ") stamps.readAt = at;
  await db.message.updateMany({
    // FAILED can be overridden only when the failure was ours (send never confirmed),
    // which is the case exactly when we never learned the wamid.
    where: {
      id: message.id,
      workspaceId,
      OR: [{ status: { in: lower } }, { status: "FAILED", whatsappMessageId: null }],
    },
    data: {
      ...wamidPatch,
      status: target as "SENT" | "DELIVERED" | "READ",
      ...stamps,
      errorMessage: null,
      errorCode: null,
    },
  });
  // Fill earlier timestamps implied by a later status, without moving status back.
  await db.message.updateMany({
    where: { id: message.id, workspaceId, sentAt: null, status: { in: ["SENT", "DELIVERED", "READ"] } },
    data: { sentAt: at },
  });
  if (target === "READ") {
    await db.message.updateMany({
      where: { id: message.id, workspaceId, deliveredAt: null, status: "READ" },
      data: { deliveredAt: at },
    });
  }
  if (Object.keys(wamidPatch).length > 0) {
    await db.message.updateMany({ where: { id: message.id, workspaceId, whatsappMessageId: null }, data: wamidPatch });
  }
  return { status: "PROCESSED" };
}

export async function handleMessagesField(workspaceId: string, p: StoredPayload): Promise<HandlerOutcome> {
  const account = p.phoneNumberId
    ? await db.whatsAppAccount.findFirst({
        where: { workspaceId, phoneNumberId: p.phoneNumberId },
        select: { id: true },
      })
    : null;
  if (!account) return { status: "IGNORED", note: "phone number not connected to this workspace" };
  const messages = Array.isArray(p.value.messages) ? (p.value.messages as Obj[]) : [];
  const statuses = Array.isArray(p.value.statuses) ? (p.value.statuses as Obj[]) : [];
  const notes: string[] = [];
  for (const m of messages) {
    const r = await handleIncomingMessage(workspaceId, account, p.value, m);
    if (r.note) notes.push(r.note);
  }
  for (const s of statuses) {
    const r = await handleStatus(workspaceId, s);
    if (r.note) notes.push(r.note);
  }
  if (messages.length === 0 && statuses.length === 0) return { status: "IGNORED", note: "no messages or statuses" };
  return { status: "PROCESSED", note: notes.join("; ") || undefined };
}

/** message_template_status_update: keeps our template status in line with Meta's review. */
export async function handleTemplateStatus(workspaceId: string, p: StoredPayload): Promise<HandlerOutcome> {
  const v = p.value;
  const providerTemplateId = v.message_template_id != null ? String(v.message_template_id) : null;
  if (!providerTemplateId) return { status: "IGNORED", note: "no template id" };
  const template = await db.template.findFirst({
    where: { workspaceId, providerTemplateId },
    select: { id: true, businessAccountId: true },
  });
  if (!template) return { status: "IGNORED", note: "template not known; sync templates to import it" };

  let status = mapMetaTemplateStatus(v.event);
  if (status === "UNKNOWN") {
    // e.g. UNARCHIVED restores the previous status: read it from Meta.
    status = (await refreshStatusFromMeta(workspaceId, template.businessAccountId, providerTemplateId)) ?? "UNKNOWN";
  }
  const info = obj(v.rejection_info);
  const reasonCode = str(v.reason);
  const reason =
    str(info.reason) ?? (reasonCode && reasonCode !== "NONE" ? reasonCode.replace(/_/g, " ").toLowerCase() : null);
  await db.template.updateMany({
    where: { id: template.id, workspaceId },
    data: {
      status: status as never,
      rejectionReason: status === "REJECTED" ? reason : null,
      lastSyncedAt: new Date(),
    },
  });
  return { status: "PROCESSED" };
}

async function refreshStatusFromMeta(workspaceId: string, wabaId: string, templateId: string) {
  try {
    const account = await db.whatsAppAccount.findFirst({
      where: { workspaceId, businessAccountId: wabaId, accessTokenRef: { not: null } },
    });
    if (!account?.accessTokenRef) return null;
    const token = await readCredential(workspaceId, account.accessTokenRef);
    const t = await getWhatsAppProvider().getTemplate(templateId, token, {
      workspaceId,
      whatsappAccountId: account.id,
    });
    return mapMetaTemplateStatus(t.status);
  } catch (error) {
    logger.warn({ err: error, templateId }, "could not refresh template status");
    return null;
  }
}
