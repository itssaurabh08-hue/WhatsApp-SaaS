import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { mediaKindOf } from "@/lib/media";
import { isWindowOpen, messagePreview } from "@/lib/messaging";
import {
  buildSendComponents,
  isSendable,
  missingValues,
  renderTemplateText,
  templateRequirements,
  type MetaTemplateComponent,
  type ParameterFormat,
  type TemplateValues,
} from "@/lib/templates";
import { db, systemDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logging/logger";
import { getWhatsAppProvider } from "@/server/providers/whatsapp";
import { MetaApiError } from "@/server/providers/whatsapp/meta/errors";
import type { OutboundContent } from "@/server/providers/whatsapp/types";
import { enqueueOutboundMessages } from "@/server/queue/queues";
import { readCredential } from "@/server/whatsapp/credentials";
import { ensureProviderMedia } from "./media";

export type OutboundRequest =
  | { kind: "text"; text: string }
  | { kind: "media"; mediaObjectId: string; caption?: string | null }
  | { kind: "template"; templateId: string; values: TemplateValues; headerMediaObjectId?: string | null };

export interface CreateOutboundInput {
  workspaceId: string;
  contactId: string;
  whatsappAccountId: string;
  request: OutboundRequest;
  sentById?: string | null;
  idempotencyKey?: string | null;
  contextMessageId?: string | null;
  campaignId?: string | null;
  /** Default true. Campaign dispatch enqueues in bulk itself. */
  enqueue?: boolean;
}

/** Template params as stored on the message. */
interface StoredTemplateParams extends TemplateValues {
  headerMediaObjectId?: string | null;
}

/**
 * Validates and records an outbound message, then queues it for delivery.
 * Enforced here (and again at delivery):
 *  - non-template messages only inside the 24-hour customer service window
 *  - templates must be APPROVED; MARKETING templates never go to opted-out contacts
 * Repeating a request with the same idempotency key returns the original message.
 */
export async function createOutboundMessage(input: CreateOutboundInput) {
  const { workspaceId } = input;
  if (input.idempotencyKey) {
    const existing = await db.message.findFirst({
      where: { workspaceId, idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;
  }

  const [account, contact] = await Promise.all([
    db.whatsAppAccount.findFirst({ where: { id: input.whatsappAccountId, workspaceId } }),
    db.contact.findFirst({ where: { id: input.contactId, workspaceId } }),
  ]);
  if (!account || !contact) throw new AppError("NOT_FOUND");
  if (account.status !== "CONNECTED") {
    throw new AppError("VALIDATION", {
      userMessage: account.statusDetail ?? "This WhatsApp number is not connected. Check Settings > WhatsApp.",
    });
  }

  const conversation = await db.conversation.upsert({
    where: {
      workspaceId_contactId_whatsappAccountId: { workspaceId, contactId: contact.id, whatsappAccountId: account.id },
    },
    create: { workspaceId, contactId: contact.id, whatsappAccountId: account.id },
    update: {},
  });

  const r = input.request;
  let type: string;
  let body: string | null = null;
  let mediaObjectId: string | null = null;
  let templateId: string | null = null;
  let templateParams: StoredTemplateParams | null = null;

  if (r.kind === "template") {
    const template = await db.template.findFirst({ where: { id: r.templateId, workspaceId } });
    if (!template || template.businessAccountId !== account.businessAccountId) {
      throw new AppError("VALIDATION", {
        userMessage: "This template does not belong to the selected WhatsApp number.",
      });
    }
    if (!isSendable(template.status)) {
      throw new AppError("VALIDATION", { userMessage: "Only approved templates can be sent." });
    }
    if (template.category === "MARKETING" && contact.optInStatus === "OPTED_OUT") {
      throw new AppError("VALIDATION", {
        userMessage: "This contact has opted out of marketing messages. Marketing templates cannot be sent to them.",
      });
    }
    const components = template.components as unknown as MetaTemplateComponent[];
    const req = templateRequirements(components);
    if (req.unsupported) {
      throw new AppError("VALIDATION", {
        userMessage: `This template uses a ${req.unsupported}, which cannot be sent from this app yet.`,
      });
    }
    const missing = missingValues(req, r.values);
    if (missing.length > 0) {
      throw new AppError("VALIDATION", { userMessage: `Fill in every template variable: ${missing.join(", ")}.` });
    }
    if (req.headerMedia && !r.headerMediaObjectId) {
      throw new AppError("VALIDATION", {
        userMessage: `This template needs a ${req.headerMedia.toLowerCase()} file for its header.`,
      });
    }
    if (r.headerMediaObjectId) await requireMedia(workspaceId, r.headerMediaObjectId);
    type = "template";
    templateId = template.id;
    templateParams = { ...r.values, headerMediaObjectId: r.headerMediaObjectId ?? null };
    body = renderTemplateText(components, r.values);
  } else {
    if (!isWindowOpen(conversation.lastInboundAt)) {
      throw new AppError("VALIDATION", {
        userMessage:
          "More than 24 hours have passed since this contact last messaged you. WhatsApp only allows an approved template now.",
      });
    }
    if (r.kind === "text") {
      const text = r.text.trim();
      if (!text) throw new AppError("VALIDATION", { userMessage: "Type a message first." });
      if (text.length > 4096)
        throw new AppError("VALIDATION", { userMessage: "Messages can be at most 4096 characters." });
      type = "text";
      body = text;
    } else {
      const media = await requireMedia(workspaceId, r.mediaObjectId);
      const kind = mediaKindOf(media.mimeType);
      if (!kind || kind === "sticker")
        throw new AppError("VALIDATION", { userMessage: "This file type cannot be sent." });
      const caption = r.caption?.trim() || null;
      if (caption && caption.length > 1024) {
        throw new AppError("VALIDATION", { userMessage: "Captions can be at most 1024 characters." });
      }
      type = kind;
      mediaObjectId = media.id;
      body = kind === "audio" ? null : caption;
    }
  }

  const now = new Date();
  let message;
  try {
    message = await db.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          workspaceId,
          conversationId: conversation.id,
          contactId: contact.id,
          whatsappAccountId: account.id,
          direction: "OUTBOUND",
          type,
          body,
          mediaObjectId,
          templateId,
          templateParams: templateParams ? (templateParams as Prisma.InputJsonValue) : Prisma.JsonNull,
          contextMessageId: input.contextMessageId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          status: "QUEUED",
          sentById: input.sentById ?? null,
          campaignId: input.campaignId ?? null,
          queuedAt: now,
        },
      });
      await tx.messageEvent.create({
        data: { workspaceId, messageId: created.id, type: "QUEUED", occurredAt: now },
      });
      await tx.conversation.updateMany({
        where: { id: conversation.id, workspaceId },
        data: { lastMessageAt: now, lastMessagePreview: messagePreview(type, body) },
      });
      return created;
    });
  } catch (error) {
    // Two identical requests raced; the other one won.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && input.idempotencyKey) {
      const existing = await db.message.findFirst({ where: { workspaceId, idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
    }
    throw error;
  }
  if (input.enqueue !== false) {
    await enqueueOutboundMessages([{ messageId: message.id, whatsappAccountId: account.id }]);
  }
  return message;
}

async function requireMedia(workspaceId: string, id: string) {
  const media = await db.mediaObject.findFirst({ where: { id, workspaceId } });
  if (!media || media.status !== "STORED")
    throw new AppError("VALIDATION", { userMessage: "The file is not available." });
  return media;
}

// ---------------------------------------------------------------------------
// Delivery (worker)
// ---------------------------------------------------------------------------

export type DeliveryOutcome = "accepted" | "failed" | "skipped" | "uncertain";

/** Thrown to make the queue retry with backoff. The message has been put back to QUEUED. */
export class RetryLaterError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RetryLaterError";
  }
}

async function fail(
  workspaceId: string,
  messageId: string,
  code: number | null,
  userMessage: string,
  title: string | null = null,
) {
  const now = new Date();
  await db.message.updateMany({
    where: { id: messageId, workspaceId, status: { in: ["QUEUED", "SENDING"] } },
    data: { status: "FAILED", errorCode: code, errorMessage: userMessage, failedAt: now },
  });
  await db.messageEvent.createMany({
    data: [{ workspaceId, messageId, type: "FAILED", occurredAt: now, errorCode: code, errorTitle: title }],
    skipDuplicates: true,
  });
}

/**
 * Sends one queued message to Meta. Safe to call more than once for the same
 * message: an atomic QUEUED -> SENDING claim means only one call ever reaches
 * Meta, and the message id is passed as biz_opaque_callback_data so status
 * webhooks can be matched even if our process dies before saving the wamid.
 *
 * Retries happen only when Meta did not accept the request (rate limit,
 * temporary error, request never sent). If the outcome is unknown (timeout
 * after sending) the message stays SENDING until a webhook confirms it or the
 * reconciler marks it failed; it is never sent twice.
 */
export async function deliverMessage(messageId: string, opts: { finalAttempt: boolean }): Promise<DeliveryOutcome> {
  const found = await systemDb.message.findUnique({ where: { id: messageId }, select: { workspaceId: true } });
  if (!found) return "skipped";
  const workspaceId = found.workspaceId;
  const claim = await db.message.updateMany({
    where: { id: messageId, workspaceId, status: "QUEUED", direction: "OUTBOUND" },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });
  if (claim.count !== 1) return "skipped";

  const message = await db.message.findFirstOrThrow({
    where: { id: messageId, workspaceId },
    include: { contact: true, whatsappAccount: true, template: true, mediaObject: true, conversation: true },
  });
  const account = message.whatsappAccount;
  const callCtx = { workspaceId, whatsappAccountId: account.id };

  try {
    if (account.status !== "CONNECTED" || !account.accessTokenRef) {
      await fail(workspaceId, messageId, null, "This WhatsApp number is not connected. Check Settings > WhatsApp.");
      return "failed";
    }
    if (message.template?.category === "MARKETING" && message.contact.optInStatus === "OPTED_OUT") {
      await fail(workspaceId, messageId, null, "Not sent: the contact opted out of marketing messages.");
      return "failed";
    }
    if (message.type === "template" && (!message.template || !isSendable(message.template.status))) {
      await fail(workspaceId, messageId, null, "Not sent: the template is no longer approved.");
      return "failed";
    }
    const token = await readCredential(workspaceId, account.accessTokenRef);
    const content = await buildContent(message, token, callCtx);
    const result = await getWhatsAppProvider().sendMessage(
      {
        phoneNumberId: account.phoneNumberId,
        to: message.contact.normalizedPhoneNumber,
        content,
        contextMessageId: message.contextMessageId,
        callbackData: message.id,
      },
      token,
      callCtx,
    );
    const now = new Date();
    const advanced = await db.message.updateMany({
      where: { id: messageId, workspaceId, status: "SENDING" },
      data: { status: "ACCEPTED", whatsappMessageId: result.messageId, acceptedAt: now, errorMessage: null },
    });
    if (advanced.count === 0) {
      // A status webhook already moved it forward; just record the wamid.
      await db.message.updateMany({
        where: { id: messageId, workspaceId },
        data: { whatsappMessageId: result.messageId },
      });
    }
    await db.messageEvent.createMany({
      data: [{ workspaceId, messageId, type: "ACCEPTED", occurredAt: now }],
      skipDuplicates: true,
    });
    return "accepted";
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (error.ambiguous) {
        await db.message.updateMany({
          where: { id: messageId, workspaceId, status: "SENDING" },
          data: { errorMessage: "No response from WhatsApp yet. Waiting for confirmation." },
        });
        logger.warn({ messageId, err: error }, "send outcome unknown; not retrying to avoid duplicates");
        return "uncertain";
      }
      if (error.info.retryable && !opts.finalAttempt) {
        await requeue(workspaceId, messageId, error.info.userMessage);
        throw new RetryLaterError(error.message);
      }
      await fail(workspaceId, messageId, error.code, error.info.userMessage, error.metaMessage.slice(0, 200));
      await afterMetaFailure(workspaceId, message.contactId, account.id, error);
      return "failed";
    }
    if (error instanceof AppError) {
      await fail(workspaceId, messageId, null, error.userMessage);
      return "failed";
    }
    // Our own failure before reaching Meta (database, storage): safe to retry.
    logger.error({ err: error, messageId }, "message delivery error");
    if (!opts.finalAttempt) {
      await requeue(workspaceId, messageId, "Temporary problem sending. Retrying.");
      throw new RetryLaterError(String(error));
    }
    await fail(workspaceId, messageId, null, "Sending failed because of a problem on our side.");
    return "failed";
  }
}

async function requeue(workspaceId: string, messageId: string, note: string) {
  await db.message.updateMany({
    where: { id: messageId, workspaceId, status: "SENDING" },
    data: { status: "QUEUED", errorMessage: note },
  });
}

/** Keeps local state in line with what Meta told us. */
async function afterMetaFailure(workspaceId: string, contactId: string, accountId: string, error: MetaApiError) {
  if (error.info.category === "auth") {
    await db.whatsAppAccount.updateMany({
      where: { id: accountId, workspaceId },
      data: { status: "NEEDS_RECONNECT", statusDetail: error.info.userMessage },
    });
  }
  if (error.code === 131050) {
    // The customer stopped marketing messages in WhatsApp; record it so we never try again.
    const updated = await db.contact.updateMany({
      where: { id: contactId, workspaceId, optInStatus: { not: "OPTED_OUT" } },
      data: { optInStatus: "OPTED_OUT", optedOutAt: new Date(), optInSource: "WhatsApp: stopped marketing messages" },
    });
    if (updated.count > 0) {
      await db.auditLog.create({
        data: {
          workspaceId,
          action: "contact.opt_in_changed",
          entityType: "Contact",
          entityId: contactId,
          metadata: { to: "OPTED_OUT", via: "meta_error_131050" },
        },
      });
    }
  }
}

type LoadedMessage = Prisma.MessageGetPayload<{
  include: { contact: true; whatsappAccount: true; template: true; mediaObject: true; conversation: true };
}>;

async function buildContent(
  message: LoadedMessage,
  token: string,
  callCtx: { workspaceId: string; whatsappAccountId: string },
): Promise<OutboundContent> {
  const account = message.whatsappAccount;
  if (message.type === "template" && message.template) {
    const params = (message.templateParams ?? {}) as StoredTemplateParams;
    let headerMediaId: string | null = null;
    if (params.headerMediaObjectId) {
      headerMediaId = await ensureProviderMedia(
        message.workspaceId,
        params.headerMediaObjectId,
        account,
        token,
        callCtx,
      );
    }
    return {
      type: "template",
      name: message.template.name,
      language: message.template.language,
      components: buildSendComponents(
        message.template.components as unknown as MetaTemplateComponent[],
        message.template.parameterFormat as ParameterFormat,
        params,
        headerMediaId,
      ),
    };
  }
  if (message.type === "text") return { type: "text", text: message.body ?? "", previewUrl: true };
  if (message.mediaObject) {
    const mediaId = await ensureProviderMedia(message.workspaceId, message.mediaObject.id, account, token, callCtx);
    return {
      type: message.type as "image" | "video" | "audio" | "document",
      mediaId,
      caption: message.body,
      fileName: message.mediaObject.fileName,
    };
  }
  throw new AppError("VALIDATION", { userMessage: "This message has nothing to send." });
}

/** Messages stuck in SENDING (unknown outcome or worker crash) are marked failed after this long. */
export const UNCONFIRMED_AFTER_MS = 60 * 60 * 1000;

/**
 * Housekeeping for the worker: re-queues QUEUED messages whose job was lost
 * (Redis down) and fails messages whose send was never confirmed.
 */
export async function reconcileOutbound(now = new Date()) {
  const stuckQueued = await systemDb.message.findMany({
    where: { status: "QUEUED", direction: "OUTBOUND", queuedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
    select: { id: true, whatsappAccountId: true },
    take: 500,
  });
  if (stuckQueued.length > 0) {
    await enqueueOutboundMessages(
      stuckQueued.map((m) => ({ messageId: m.id, whatsappAccountId: m.whatsappAccountId })),
    );
  }

  const unconfirmed = await systemDb.message.findMany({
    where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - UNCONFIRMED_AFTER_MS) } },
    select: { id: true, workspaceId: true },
    take: 500,
  });
  for (const m of unconfirmed) {
    await fail(
      m.workspaceId,
      m.id,
      null,
      "WhatsApp did not confirm this message. It may not have been sent. Check with the contact before resending.",
    );
  }
  return { requeued: stuckQueued.length, failed: unconfirmed.length };
}
