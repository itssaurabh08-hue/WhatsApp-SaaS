import "server-only";
import type { WebhookEventStatus } from "@/generated/prisma/client";
import { systemDb } from "@/server/db/client";
import { logger } from "@/server/logging/logger";

import { handleMessagesField, handleTemplateStatus, type StoredPayload } from "@/server/messaging/inbound";

type Outcome = { status: WebhookEventStatus; note?: string };

/**
 * Fields stored without a handler. Events in DEFERRED state are replayed by the
 * worker once a handler for their field exists (see findDeferredEvents).
 */
const DEFERRED_FIELDS = new Set<string>([]);

/** Template fields we receive but do not use (quality and category changes are visible in WhatsApp Manager). */
const UNUSED_FIELDS = new Set([
  "message_template_quality_update",
  "message_template_components_update",
  "template_category_update",
]);

const DISCONNECT_EVENTS: Record<string, { status: "DISCONNECTED" | "NEEDS_RECONNECT" | "RESTRICTED"; detail: string }> =
  {
    PARTNER_APP_UNINSTALLED: {
      status: "DISCONNECTED",
      detail: "The WhatsApp Business account owner removed this app's access. Reconnect to continue.",
    },
    ACCOUNT_DELETED: { status: "DISCONNECTED", detail: "The WhatsApp Business account was deleted in Meta." },
    ACCOUNT_OFFBOARDED: {
      status: "NEEDS_RECONNECT",
      detail: "The phone number was re-registered elsewhere. Reconnect to continue.",
    },
    ACCOUNT_RESTRICTION: {
      status: "RESTRICTED",
      detail: "Meta restricted this WhatsApp Business account for policy reasons. Check WhatsApp Manager.",
    },
    ACCOUNT_VIOLATION: {
      status: "RESTRICTED",
      detail: "Meta reported a policy violation on this WhatsApp Business account. Check WhatsApp Manager.",
    },
    DISABLED_UPDATE: {
      status: "RESTRICTED",
      detail: "Meta disabled this WhatsApp Business account for policy reasons. Check WhatsApp Manager.",
    },
  };

async function handleAccountUpdate(workspaceId: string, p: StoredPayload): Promise<Outcome> {
  const event = String(p.value.event ?? "");
  const mapping = DISCONNECT_EVENTS[event];
  if (!mapping || !p.businessAccountId) return { status: "PROCESSED", note: `no action for ${event || "event"}` };
  await systemDb.whatsAppAccount.updateMany({
    where: { workspaceId, businessAccountId: p.businessAccountId, status: { not: "DISCONNECTED" } },
    data: { status: mapping.status, statusDetail: mapping.detail },
  });
  return { status: "PROCESSED" };
}

async function handleQualityUpdate(workspaceId: string, p: StoredPayload): Promise<Outcome> {
  const limit = p.value.max_daily_conversations_per_business ?? p.value.current_limit;
  const display =
    typeof p.value.display_phone_number === "string" ? p.value.display_phone_number.replace(/\D/g, "") : null;
  if (typeof limit !== "string" || !p.businessAccountId) return { status: "PROCESSED", note: "no limit in payload" };
  const accounts = await systemDb.whatsAppAccount.findMany({
    where: { workspaceId, businessAccountId: p.businessAccountId },
    select: { id: true, displayPhoneNumber: true },
  });
  // The limit is portfolio-wide; update every number of this WABA, or the matching one if identifiable.
  const match = display ? accounts.filter((a) => a.displayPhoneNumber?.replace(/\D/g, "") === display) : [];
  const targets = (match.length > 0 ? match : accounts).map((a) => a.id);
  await systemDb.whatsAppAccount.updateMany({
    where: { id: { in: targets }, workspaceId },
    data: { messagingLimit: limit },
  });
  return { status: "PROCESSED" };
}

/**
 * Marketing opt-out from WhatsApp (WA/webhooks/reference/user_preferences).
 * "stop" opts the contact out; "resume" restores opt-in only if they were opted out.
 */
async function handleUserPreferences(workspaceId: string, p: StoredPayload): Promise<Outcome> {
  const prefs = Array.isArray(p.value.user_preferences) ? (p.value.user_preferences as Record<string, unknown>[]) : [];
  const now = new Date();
  for (const pref of prefs) {
    if (pref.category !== "marketing_messages" || typeof pref.wa_id !== "string") continue;
    const phone = `+${pref.wa_id.replace(/\D/g, "")}`;
    const contact = await systemDb.contact.findFirst({
      where: { workspaceId, normalizedPhoneNumber: phone },
      select: { id: true, optInStatus: true },
    });
    if (!contact) continue;
    if (pref.value === "stop" && contact.optInStatus !== "OPTED_OUT") {
      await systemDb.contact.updateMany({
        where: { id: contact.id, workspaceId },
        data: { optInStatus: "OPTED_OUT", optedOutAt: now, optInSource: "WhatsApp: stopped marketing messages" },
      });
      await systemDb.auditLog.create({
        data: {
          workspaceId,
          action: "contact.opt_in_changed",
          entityType: "Contact",
          entityId: contact.id,
          metadata: { from: contact.optInStatus, to: "OPTED_OUT", via: "whatsapp_user_preferences" },
        },
      });
    } else if (pref.value === "resume" && contact.optInStatus === "OPTED_OUT") {
      await systemDb.contact.updateMany({
        where: { id: contact.id, workspaceId },
        data: { optInStatus: "OPTED_IN", optInAt: now, optInSource: "WhatsApp: resumed marketing messages" },
      });
      await systemDb.auditLog.create({
        data: {
          workspaceId,
          action: "contact.opt_in_changed",
          entityType: "Contact",
          entityId: contact.id,
          metadata: { from: "OPTED_OUT", to: "OPTED_IN", via: "whatsapp_user_preferences" },
        },
      });
    }
  }
  return { status: "PROCESSED" };
}

async function dispatch(eventType: string, workspaceId: string | null, payload: StoredPayload): Promise<Outcome> {
  if (!workspaceId) return { status: "IGNORED", note: "no connected WhatsApp account matches this event" };
  if (DEFERRED_FIELDS.has(eventType)) return { status: "DEFERRED", note: "handler not implemented yet" };
  if (UNUSED_FIELDS.has(eventType)) return { status: "IGNORED", note: `${eventType} is not used` };
  switch (eventType) {
    case "messages":
      return handleMessagesField(workspaceId, payload);
    case "message_template_status_update":
      return handleTemplateStatus(workspaceId, payload);
    case "account_update":
      return handleAccountUpdate(workspaceId, payload);
    case "phone_number_quality_update":
      return handleQualityUpdate(workspaceId, payload);
    case "user_preferences":
      return handleUserPreferences(workspaceId, payload);
    default:
      return { status: "IGNORED", note: `unsupported field ${eventType}` };
  }
}

/**
 * Processes one stored event. Idempotent: events already in a final state are
 * skipped, and handlers only move state forward. Throws on failure so the
 * queue retries with backoff.
 */
export async function processWebhookEvent(eventId: string): Promise<WebhookEventStatus | "MISSING"> {
  const event = await systemDb.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event) return "MISSING";
  const replayable =
    event.status === "RECEIVED" ||
    event.status === "FAILED" ||
    (event.status === "DEFERRED" && !DEFERRED_FIELDS.has(event.eventType));
  if (!replayable) return event.status;
  await systemDb.webhookEvent.update({ where: { id: eventId }, data: { attempts: { increment: 1 } } });
  try {
    const outcome = await dispatch(event.eventType, event.workspaceId, event.payload as unknown as StoredPayload);
    await systemDb.webhookEvent.update({
      where: { id: eventId },
      data: { status: outcome.status, error: outcome.note ?? null, processedAt: new Date() },
    });
    return outcome.status;
  } catch (error) {
    logger.error({ err: error, eventId, eventType: event.eventType }, "webhook processing failed");
    await systemDb.webhookEvent.update({
      where: { id: eventId },
      data: { status: "FAILED", error: String(error).slice(0, 1000) },
    });
    throw error;
  }
}

/** Ids of events that were stored but never processed (e.g. Redis was down when they arrived). */
export async function findUnprocessedEvents(olderThanMs = 60_000, limit = 500) {
  const rows = await systemDb.webhookEvent.findMany({
    where: { status: "RECEIVED", createdAt: { lt: new Date(Date.now() - olderThanMs) } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Ids of DEFERRED events whose field now has a handler, oldest first (replayed in arrival order). */
export async function findDeferredEvents(limit = 200) {
  const rows = await systemDb.webhookEvent.findMany({
    where: { status: "DEFERRED", eventType: { notIn: [...DEFERRED_FIELDS] } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
