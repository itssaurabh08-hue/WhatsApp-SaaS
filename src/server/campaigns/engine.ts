import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { resolveValues, type Audience, type VariableMapping } from "@/lib/campaigns";
import { isSendable, templateRequirements, type MetaTemplateComponent } from "@/lib/templates";
import { db, systemDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logging/logger";
import { ensureProviderMedia } from "@/server/messaging/media";
import { createOutboundMessage } from "@/server/messaging/outbound";
import { enqueueOutboundMessages, type OutboundJobData } from "@/server/queue/queues";
import { sendRatePerSecond } from "@/server/queue/send-rate";
import { getRedis } from "@/server/redis";
import { readCredential } from "@/server/whatsapp/credentials";
import { audienceWhere } from "./audience";

/**
 * Campaign engine, run by the worker every few seconds:
 *  1. SCHEDULED campaigns whose time has come move to SENDING (atomic claim).
 *  2. The audience is snapshotted into CampaignRecipient rows (unique per contact,
 *     so nobody receives a campaign twice), applying the opt-in rules.
 *  3. Recipients are handed to the send queue in small batches (about ten seconds
 *     of sending at the number's rate), so pause and cancel take effect quickly and
 *     queue depth stays bounded. Each message has the idempotency key
 *     campaign:<id>:<contactId>, so a repeated dispatch cannot create a second message.
 *  4. When nothing is pending or in flight, the campaign is COMPLETED.
 */

const SNAPSHOT_PAGE = 2000;
const IN_FLIGHT_SECONDS = 10;

async function withLock(key: string, ttlMs: number, fn: () => Promise<void>) {
  let acquired = true;
  const redis = getRedis();
  const lockKey = `${process.env.QUEUE_PREFIX || "whatsflow"}:lock:${key}`;
  try {
    acquired = (await redis.set(lockKey, "1", "PX", ttlMs, "NX")) === "OK";
  } catch {
    acquired = true; // Redis down: run anyway; idempotency keys keep it safe.
  }
  if (!acquired) return;
  try {
    await fn();
  } finally {
    await redis.del(lockKey).catch(() => undefined);
  }
}

export async function runCampaignTick(now = new Date()) {
  await withLock("campaign-tick", 60_000, async () => {
    const due = await systemDb.campaign.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: now } },
      select: { id: true },
      take: 50,
    });
    for (const c of due) {
      await systemDb.campaign.updateMany({
        where: { id: c.id, status: "SCHEDULED" },
        data: { status: "SENDING", startedAt: now, statusDetail: null },
      });
    }
    const active = await systemDb.campaign.findMany({
      where: { status: "SENDING" },
      orderBy: { startedAt: "asc" },
      select: { id: true, workspaceId: true },
      take: 50,
    });
    for (const c of active) {
      try {
        await snapshotRecipients(c.workspaceId, c.id);
        await dispatchBatch(c.workspaceId, c.id);
        await completeIfDone(c.workspaceId, c.id);
      } catch (error) {
        logger.error({ err: error, campaignId: c.id }, "campaign tick failed");
      }
    }
  });
}

async function pause(workspaceId: string, id: string, detail: string) {
  await db.campaign.updateMany({
    where: { id, workspaceId, status: "SENDING" },
    data: { status: "PAUSED", statusDetail: detail },
  });
  logger.warn({ campaignId: id, detail }, "campaign paused automatically");
}

export async function snapshotRecipients(workspaceId: string, campaignId: string) {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { template: { select: { category: true } } },
  });
  if (!campaign || campaign.recipientsReadyAt) return;
  const marketing = campaign.template?.category === "MARKETING";
  const where = await audienceWhere(workspaceId, campaign.audience as Audience);
  let cursor: string | undefined;
  for (;;) {
    const page = await db.contact.findMany({
      where,
      orderBy: { id: "asc" },
      take: SNAPSHOT_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, optInStatus: true },
    });
    if (page.length === 0) break;
    const rows: Prisma.CampaignRecipientCreateManyInput[] = page.map((c) => {
      const skipReason =
        c.optInStatus === "OPTED_OUT"
          ? "Opted out"
          : marketing && !campaign.includeUnknownOptIn && c.optInStatus !== "OPTED_IN"
            ? "No marketing opt-in recorded"
            : null;
      return { workspaceId, campaignId, contactId: c.id, status: skipReason ? "SKIPPED" : "PENDING", skipReason };
    });
    await db.campaignRecipient.createMany({ data: rows, skipDuplicates: true });
    cursor = page[page.length - 1]!.id;
    if (page.length < SNAPSHOT_PAGE) break;
  }
  const [total, skipped] = await Promise.all([
    db.campaignRecipient.count({ where: { workspaceId, campaignId } }),
    db.campaignRecipient.count({ where: { workspaceId, campaignId, status: "SKIPPED" } }),
  ]);
  await db.campaign.updateMany({
    where: { id: campaignId, workspaceId },
    data: { recipientsReadyAt: new Date(), recipientCount: total, skippedCount: skipped },
  });
}

export async function dispatchBatch(workspaceId: string, campaignId: string) {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { template: true, whatsappAccount: true },
  });
  if (!campaign || campaign.status !== "SENDING" || !campaign.recipientsReadyAt) return;
  const account = campaign.whatsappAccount;
  if (account.status !== "CONNECTED" || !account.accessTokenRef) {
    return pause(workspaceId, campaignId, "Paused: the WhatsApp number is not connected. Reconnect it, then resume.");
  }
  const template = campaign.template;
  if (!template || !isSendable(template.status)) {
    return pause(workspaceId, campaignId, "Paused: the template is no longer approved by Meta.");
  }

  const inFlight = await db.message.count({
    where: { workspaceId, campaignId, status: { in: ["QUEUED", "SENDING"] } },
  });
  const budget = sendRatePerSecond() * IN_FLIGHT_SECONDS - inFlight;
  if (budget <= 0) return;

  const recipients = await db.campaignRecipient.findMany({
    where: { workspaceId, campaignId, status: "PENDING" },
    orderBy: { id: "asc" },
    take: Math.min(budget, 500),
    include: { contact: true },
  });
  if (recipients.length === 0) return;

  const components = template.components as unknown as MetaTemplateComponent[];
  const req = templateRequirements(components);
  if (campaign.headerMediaObjectId) {
    // Upload the header file once before fanning out.
    const token = await readCredential(workspaceId, account.accessTokenRef);
    await ensureProviderMedia(workspaceId, campaign.headerMediaObjectId, account, token, {
      workspaceId,
      whatsappAccountId: account.id,
    });
  }
  const mapping = campaign.variableMapping as VariableMapping;
  const marketing = template.category === "MARKETING";
  const jobs: OutboundJobData[] = [];

  for (const r of recipients) {
    const skip = (reason: string) =>
      db.campaignRecipient.updateMany({
        where: { id: r.id, workspaceId, status: "PENDING" },
        data: { status: "SKIPPED", skipReason: reason },
      });
    // Opt-in may have changed since the snapshot.
    if (r.contact.optInStatus === "OPTED_OUT") {
      await skip("Opted out");
      continue;
    }
    if (marketing && !campaign.includeUnknownOptIn && r.contact.optInStatus !== "OPTED_IN") {
      await skip("No marketing opt-in recorded");
      continue;
    }
    const { values, missing } = resolveValues(r.contact, mapping, req);
    if (missing.length > 0) {
      await skip(`No value for ${missing.join(", ")}`);
      continue;
    }
    try {
      const message = await createOutboundMessage({
        workspaceId,
        contactId: r.contactId,
        whatsappAccountId: account.id,
        request: {
          kind: "template",
          templateId: template.id,
          values,
          headerMediaObjectId: campaign.headerMediaObjectId,
        },
        sentById: null,
        campaignId,
        idempotencyKey: `campaign:${campaignId}:${r.contactId}`,
        enqueue: false,
      });
      await db.campaignRecipient.updateMany({
        where: { id: r.id, workspaceId },
        data: { status: "QUEUED", messageId: message.id },
      });
      if (message.status === "QUEUED") jobs.push({ messageId: message.id, whatsappAccountId: account.id });
    } catch (error) {
      if (error instanceof AppError) {
        await skip(error.userMessage.slice(0, 300));
        continue;
      }
      throw error;
    }
  }
  await enqueueOutboundMessages(jobs);
}

export async function completeIfDone(workspaceId: string, campaignId: string) {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!campaign || campaign.status !== "SENDING" || !campaign.recipientsReadyAt) return;
  const [pending, inFlight, skipped] = await Promise.all([
    db.campaignRecipient.count({ where: { workspaceId, campaignId, status: "PENDING" } }),
    db.message.count({ where: { workspaceId, campaignId, status: { in: ["QUEUED", "SENDING"] } } }),
    db.campaignRecipient.count({ where: { workspaceId, campaignId, status: "SKIPPED" } }),
  ]);
  if (pending > 0 || inFlight > 0) return;
  await db.campaign.updateMany({
    where: { id: campaignId, workspaceId, status: "SENDING" },
    data: { status: "COMPLETED", completedAt: new Date(), skippedCount: skipped },
  });
}

/** Called for each incoming message: credits the latest campaign message to this contact in the last 72 hours. */
export async function attributeReply(workspaceId: string, contactId: string, whatsappAccountId: string, at: Date) {
  const since = new Date(at.getTime() - 72 * 3600 * 1000);
  const recipient = await db.campaignRecipient.findFirst({
    where: {
      workspaceId,
      contactId,
      repliedAt: null,
      message: { whatsappAccountId, createdAt: { gte: since, lte: at }, status: { not: "FAILED" } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (recipient) {
    await db.campaignRecipient.updateMany({
      where: { id: recipient.id, workspaceId, repliedAt: null },
      data: { repliedAt: at },
    });
  }
}
