import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, systemDb } from "@/server/db/client";
import { setWhatsAppProviderForTests } from "@/server/providers/whatsapp";
import { ingestMetaWebhook } from "@/server/webhooks/meta-ingest";
import { processWebhookEvent } from "@/server/webhooks/meta-processor";
import { completeEmbeddedSignup } from "@/server/whatsapp/connection";
import { createContact } from "@/server/contacts/service";
import { happyMeta, PHONE_ID, WABA_ID } from "../support/fake-meta";
import { ownerContext } from "../support/factories";

const SECRET = "test-app-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

function body(field: string, value: Record<string, unknown>, wabaId = WABA_ID) {
  return JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field, value }] }] });
}

const metadata = { display_phone_number: "15550783881", phone_number_id: PHONE_ID };

async function connected() {
  setWhatsAppProviderForTests(null, happyMeta().fetch);
  const ctx = await ownerContext();
  await completeEmbeddedSignup(ctx, { code: "AQB", wabaId: WABA_ID, phoneNumberId: PHONE_ID });
  return ctx;
}

async function ingestAndProcess(raw: string) {
  const result = await ingestMetaWebhook(raw, sign(raw), SECRET);
  const events = await systemDb.webhookEvent.findMany({ where: { status: "RECEIVED" } });
  for (const e of events) await processWebhookEvent(e.id);
  return result;
}

beforeEach(() => {
  process.env.REDIS_URL = "redis://127.0.0.1:6379";
});
afterEach(() => setWhatsAppProviderForTests(null));

describe("webhook ingestion", () => {
  it("rejects invalid signatures without storing anything", async () => {
    const raw = body("messages", {
      messaging_product: "whatsapp",
      metadata,
      messages: [{ id: "wamid.1", from: "1", type: "text" }],
    });
    expect((await ingestMetaWebhook(raw, "sha256=deadbeef", SECRET)).status).toBe(401);
    expect((await ingestMetaWebhook(raw, null, SECRET)).status).toBe(401);
    expect(await systemDb.webhookEvent.count()).toBe(0);
  });

  it("stores each change once, routed to the workspace, even when Meta retries", async () => {
    const ctx = await connected();
    const raw = body("messages", {
      messaging_product: "whatsapp",
      metadata,
      messages: [{ id: "wamid.1", from: "16505551234", timestamp: "1", type: "text", text: { body: "hi" } }],
      statuses: [{ id: "wamid.2", status: "delivered", timestamp: "2", recipient_id: "16505551234" }],
    });
    expect(await ingestMetaWebhook(raw, sign(raw), SECRET)).toEqual({ status: 200, stored: 2, duplicates: 0 });
    expect(await ingestMetaWebhook(raw, sign(raw), SECRET)).toEqual({ status: 200, stored: 0, duplicates: 2 });
    const events = await systemDb.webhookEvent.findMany();
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.workspaceId === ctx.workspaceId)).toBe(true);
  });

  it("returns 400 for malformed JSON with a valid signature", async () => {
    const raw = "{not json";
    expect((await ingestMetaWebhook(raw, sign(raw), SECRET)).status).toBe(400);
  });

  it("keeps message events DEFERRED until messaging handlers exist, and ignores unknown accounts", async () => {
    await connected();
    await ingestAndProcess(
      body("messages", {
        messaging_product: "whatsapp",
        metadata,
        messages: [{ id: "wamid.9", from: "1", type: "text" }],
      }),
    );
    await ingestAndProcess(
      body(
        "messages",
        {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: "000" },
          messages: [{ id: "wamid.10", from: "1", type: "text" }],
        },
        "OTHERWABA",
      ),
    );
    const byKey = Object.fromEntries((await systemDb.webhookEvent.findMany()).map((e) => [e.dedupeKey, e.status]));
    expect(byKey["msg:wamid.9"]).toBe("DEFERRED");
    expect(byKey["msg:wamid.10"]).toBe("IGNORED");
  });
});

describe("webhook processing", () => {
  it("opts a contact out when they stop marketing messages, and back in on resume", async () => {
    const ctx = await connected();
    const { id } = await createContact(ctx, {
      phoneNumber: "+16505551234",
      firstName: "Sheena",
      lastName: null,
      email: null,
      company: null,
      country: null,
      optInStatus: "OPTED_IN",
      optInSource: null,
      customFields: {},
    });
    const pref = (value: string, ts: number) =>
      body("user_preferences", {
        messaging_product: "whatsapp",
        metadata,
        user_preferences: [{ wa_id: "16505551234", detail: "x", category: "marketing_messages", value, timestamp: ts }],
      });
    await ingestAndProcess(pref("stop", 1));
    let c = await db.contact.findFirstOrThrow({ where: { id, workspaceId: ctx.workspaceId } });
    expect(c.optInStatus).toBe("OPTED_OUT");
    expect(c.optedOutAt).not.toBeNull();

    await ingestAndProcess(pref("resume", 2));
    c = await db.contact.findFirstOrThrow({ where: { id, workspaceId: ctx.workspaceId } });
    expect(c.optInStatus).toBe("OPTED_IN");
    expect(
      await db.auditLog.count({
        where: { workspaceId: ctx.workspaceId, action: "contact.opt_in_changed", entityId: id },
      }),
    ).toBe(2);
  });

  it("marks accounts disconnected when the customer uninstalls the app", async () => {
    const ctx = await connected();
    await ingestAndProcess(body("account_update", { event: "PARTNER_APP_UNINSTALLED" }));
    const acc = await db.whatsAppAccount.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId } });
    expect(acc.status).toBe("DISCONNECTED");
    expect(acc.statusDetail).toMatch(/removed this app's access/);
  });

  it("updates the messaging limit from quality updates", async () => {
    const ctx = await connected();
    await ingestAndProcess(
      body("phone_number_quality_update", {
        display_phone_number: "15550783881",
        event: "UPGRADE",
        max_daily_conversations_per_business: "TIER_2K",
      }),
    );
    const acc = await db.whatsAppAccount.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId } });
    expect(acc.messagingLimit).toBe("TIER_2K");
  });

  it("is idempotent: reprocessing a finished event does nothing", async () => {
    await connected();
    await ingestAndProcess(body("account_update", { event: "VOLUME_BASED_PRICING_TIER_UPDATE" }));
    const event = await systemDb.webhookEvent.findFirstOrThrow();
    expect(event.status).toBe("PROCESSED");
    expect(await processWebhookEvent(event.id)).toBe("PROCESSED");
    expect((await systemDb.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).attempts).toBe(1);
  });
});
