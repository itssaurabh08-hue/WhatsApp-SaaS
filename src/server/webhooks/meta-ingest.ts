import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { systemDb } from "@/server/db/client";
import { logger } from "@/server/logging/logger";
import { normalizeMetaWebhook, verifyMetaSignature } from "@/server/providers/whatsapp/meta/webhooks";
import { enqueueWebhookEvents } from "@/server/queue/queues";

export type IngestResult = { status: 200 | 400 | 401 | 503; stored: number; duplicates: number };

/**
 * Handles a Meta webhook POST: verify signature on the raw body, split into
 * changes, route each to a workspace by phone number or WABA, store with a
 * unique dedupe key (Meta retries for up to 7 days) and enqueue processing.
 * Must stay fast: Meta expects a quick 200.
 */
export async function ingestMetaWebhook(
  rawBody: string,
  signature: string | null,
  appSecret: string,
): Promise<IngestResult> {
  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    logger.warn({ hasSignature: !!signature }, "meta webhook rejected: invalid signature");
    return { status: 401, stored: 0, duplicates: 0 };
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400, stored: 0, duplicates: 0 };
  }
  const changes = normalizeMetaWebhook(body);
  if (changes.length === 0) return { status: 200, stored: 0, duplicates: 0 };

  // Cross-tenant by design: the payload identifies the business, not a session.
  const phoneIds = [...new Set(changes.map((c) => c.phoneNumberId).filter((x): x is string => !!x))];
  const wabaIds = [...new Set(changes.map((c) => c.businessAccountId).filter((x): x is string => !!x))];
  const accounts = await systemDb.whatsAppAccount.findMany({
    where: {
      OR: [{ phoneNumberId: { in: phoneIds } }, { businessAccountId: { in: wabaIds } }],
      status: { not: "DISCONNECTED" },
    },
    select: { id: true, workspaceId: true, phoneNumberId: true, businessAccountId: true, displayPhoneNumber: true },
  });
  const byPhone = new Map(accounts.map((a) => [a.phoneNumberId, a]));
  const byWaba = new Map<string, (typeof accounts)[number]>();
  for (const a of accounts) if (!byWaba.has(a.businessAccountId)) byWaba.set(a.businessAccountId, a);

  const rows = changes.map((c) => {
    const account =
      (c.phoneNumberId && byPhone.get(c.phoneNumberId)) ||
      (c.businessAccountId && byWaba.get(c.businessAccountId)) ||
      null;
    return {
      provider: "META",
      dedupeKey: c.dedupeKey,
      eventType: c.field,
      workspaceId: account?.workspaceId ?? null,
      whatsappAccountId: account?.id ?? null,
      payload: {
        businessAccountId: c.businessAccountId,
        phoneNumberId: c.phoneNumberId,
        value: c.value,
      } as Prisma.InputJsonValue,
    };
  });

  try {
    const created = await systemDb.webhookEvent.createManyAndReturn({
      data: rows,
      skipDuplicates: true,
      select: { id: true },
    });
    await enqueueWebhookEvents(created.map((r) => r.id));
    return { status: 200, stored: created.length, duplicates: rows.length - created.length };
  } catch (error) {
    // Not acknowledging makes Meta retry, which is what we want if we could not store the event.
    logger.error({ err: error }, "failed to store meta webhook");
    return { status: 503, stored: 0, duplicates: 0 };
  }
}
