import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/campaigns";
import { completeIfDone, dispatchBatch, runCampaignTick } from "@/server/campaigns/engine";
import {
  changeCampaignState,
  createCampaign,
  estimateAudience,
  getCampaign,
  launchCampaign,
  listRecipients,
  type CampaignInput,
} from "@/server/campaigns/service";
import { createContact } from "@/server/contacts/service";
import { db, systemDb } from "@/server/db/client";
import { deliverMessage } from "@/server/messaging/outbound";
import { setWhatsAppProviderForTests } from "@/server/providers/whatsapp";
import { syncTemplates } from "@/server/templates/service";
import { ingestMetaWebhook } from "@/server/webhooks/meta-ingest";
import { processWebhookEvent } from "@/server/webhooks/meta-processor";
import { completeEmbeddedSignup } from "@/server/whatsapp/connection";
import { happyMeta, PHONE_ID, WABA_ID, withMessaging, type FakeMeta } from "../support/fake-meta";
import { memberContext, ownerContext, testPhone } from "../support/factories";
import type { TenantContext } from "@/server/authz/tenant";

let fake: FakeMeta;
const sends = () => fake.callsTo("POST", new RegExp(`^/${PHONE_ID}/messages$`));

async function setup() {
  fake = withMessaging(happyMeta());
  setWhatsAppProviderForTests(null, fake.fetch);
  const ctx = await ownerContext();
  await completeEmbeddedSignup(ctx, { code: "AQB", wabaId: WABA_ID, phoneNumberId: PHONE_ID });
  const account = await db.whatsAppAccount.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId } });
  await syncTemplates(ctx, account.id);
  const utility = await db.template.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId, name: "order_update" } });
  const marketing = await db.template.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId, name: "spring_sale" } });
  const list = await db.contactList.create({ data: { workspaceId: ctx.workspaceId, name: "Customers" } });
  return { ctx, account, utility, marketing, list };
}

async function contact(
  ctx: TenantContext,
  listId: string,
  firstName: string | null,
  optInStatus: "OPTED_IN" | "OPTED_OUT" | "UNKNOWN",
  phone = testPhone(),
) {
  const c = await createContact(ctx, {
    phoneNumber: phone,
    firstName,
    lastName: null,
    email: null,
    company: null,
    country: null,
    optInStatus,
    optInSource: null,
    customFields: {},
  });
  await db.contactListMember.create({ data: { workspaceId: ctx.workspaceId, listId, contactId: c.id } });
  return c;
}

function utilityInput(s: Awaited<ReturnType<typeof setup>>, overrides: Partial<CampaignInput> = {}): CampaignInput {
  return {
    name: "October shipping",
    whatsappAccountId: s.account.id,
    templateId: s.utility.id,
    audience: { type: "list", id: s.list.id },
    variableMapping: {
      header: {},
      body: {
        "1": { source: "field", field: "firstName", fallback: "there" },
        "2": { source: "static", value: "A-100" },
      },
      buttons: {},
    },
    includeUnknownOptIn: false,
    ...overrides,
  };
}

async function deliverAll(workspaceId: string, campaignId: string) {
  const messages = await db.message.findMany({ where: { workspaceId, campaignId, status: "QUEUED" } });
  for (const m of messages) await deliverMessage(m.id, { finalAttempt: false });
  return messages.length;
}

afterEach(() => {
  setWhatsAppProviderForTests(null);
  delete process.env.WHATSAPP_SEND_RATE_PER_SECOND;
});

describe("campaigns", () => {
  it("validates the template, variables and audience", async () => {
    const s = await setup();
    await expect(
      createCampaign(s.ctx, utilityInput(s, { variableMapping: { header: {}, body: {}, buttons: {} } })),
    ).rejects.toMatchObject({ userMessage: expect.stringContaining("{{1}}") });
    await db.template.updateMany({ where: { id: s.utility.id, workspaceId: s.ctx.workspaceId }, data: { status: "PAUSED" } });
    await expect(createCampaign(s.ctx, utilityInput(s))).rejects.toMatchObject({
      userMessage: expect.stringContaining("approved"),
    });
    const agent = await memberContext(s.ctx, "AGENT");
    await expect(createCampaign(agent, utilityInput(s))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("estimates the audience with the opt-in rules", async () => {
    const s = await setup();
    await contact(s.ctx, s.list.id, "Ana", "OPTED_IN");
    await contact(s.ctx, s.list.id, "Ben", "UNKNOWN");
    await contact(s.ctx, s.list.id, "Cy", "OPTED_OUT");
    const audience = { type: "list" as const, id: s.list.id };
    expect(await estimateAudience(s.ctx, { audience, templateId: s.utility.id, includeUnknownOptIn: false })).toMatchObject({
      total: 3,
      eligible: 2,
      optedOut: 1,
    });
    expect(await estimateAudience(s.ctx, { audience, templateId: s.marketing.id, includeUnknownOptIn: false })).toMatchObject({
      eligible: 1,
      unknownExcluded: 1,
    });
    expect(await estimateAudience(s.ctx, { audience, templateId: s.marketing.id, includeUnknownOptIn: true })).toMatchObject({
      eligible: 2,
    });
  });

  it("sends once per contact, skips opted-out contacts and never duplicates on retries", async () => {
    const s = await setup();
    const ana = await contact(s.ctx, s.list.id, "Ana", "OPTED_IN");
    await contact(s.ctx, s.list.id, null, "UNKNOWN");
    await contact(s.ctx, s.list.id, "Cy", "OPTED_OUT");
    const campaign = await createCampaign(s.ctx, utilityInput(s));
    await launchCampaign(s.ctx, campaign.id, null);

    await runCampaignTick();
    // Repeated ticks, dispatches and deliveries must not create or send anything twice.
    await runCampaignTick();
    await dispatchBatch(s.ctx.workspaceId, campaign.id);
    expect(await db.message.count({ where: { workspaceId: s.ctx.workspaceId, campaignId: campaign.id } })).toBe(2);
    await deliverAll(s.ctx.workspaceId, campaign.id);
    await deliverAll(s.ctx.workspaceId, campaign.id);
    for (const m of await db.message.findMany({ where: { workspaceId: s.ctx.workspaceId, campaignId: campaign.id } })) {
      await deliverMessage(m.id, { finalAttempt: false });
    }
    expect(sends()).toHaveLength(2);

    const bodies = sends().map((c) => JSON.stringify(c.body));
    expect(bodies.some((b) => b.includes('"text":"Ana"'))).toBe(true);
    expect(bodies.some((b) => b.includes('"text":"there"'))).toBe(true); // fallback for the missing first name
    expect(bodies.every((b) => b.includes('"text":"A-100"'))).toBe(true);

    const recipients = await db.campaignRecipient.findMany({ where: { workspaceId: s.ctx.workspaceId, campaignId: campaign.id } });
    expect(recipients.map((r) => r.status).sort()).toEqual(["QUEUED", "QUEUED", "SKIPPED"]);
    expect(recipients.find((r) => r.status === "SKIPPED")?.skipReason).toBe("Opted out");

    await completeIfDone(s.ctx.workspaceId, campaign.id);
    const done = await getCampaign(s.ctx, campaign.id);
    expect(done.status).toBe("COMPLETED");
    expect(done).toMatchObject({ recipientCount: 3, skippedCount: 1 });
    expect(done.stats).toMatchObject({ accepted: 2, failed: 0, skipped: 1, pending: 0 });
    expect(ana.id).toBeTruthy();
  });

  it("sends marketing only to opted-in contacts unless unknown is allowed, re-checking at dispatch", async () => {
    const s = await setup();
    const ana = await contact(s.ctx, s.list.id, "Ana", "OPTED_IN");
    await contact(s.ctx, s.list.id, "Ben", "UNKNOWN");
    const bo = await contact(s.ctx, s.list.id, "Bo", "OPTED_IN");
    const campaign = await createCampaign(s.ctx, {
      ...utilityInput(s),
      templateId: s.marketing.id,
      variableMapping: {
        header: {},
        body: { first_name: { source: "field", field: "firstName", fallback: "" } },
        buttons: { "0": { source: "static", value: "fall sale" } },
      },
    });
    await launchCampaign(s.ctx, campaign.id, null);
    await runCampaignTick();
    expect(await db.message.count({ where: { workspaceId: s.ctx.workspaceId, campaignId: campaign.id } })).toBe(2);

    // A second marketing campaign: Bo opts out between snapshot and dispatch.
    process.env.WHATSAPP_SEND_RATE_PER_SECOND = "0.1"; // budget of 1 message per dispatch
    const second = await createCampaign(s.ctx, { ...utilityInput(s), name: "Second", templateId: s.marketing.id, variableMapping: {
      header: {},
      body: { first_name: { source: "static", value: "friend" } },
      buttons: { "0": { source: "static", value: "x" } },
    } });
    await launchCampaign(s.ctx, second.id, null);
    await runCampaignTick();
    expect(await db.message.count({ where: { workspaceId: s.ctx.workspaceId, campaignId: second.id } })).toBe(1);
    await db.message.updateMany({ where: { workspaceId: s.ctx.workspaceId, campaignId: second.id }, data: { status: "ACCEPTED" } });
    const firstQueued = await db.campaignRecipient.findFirstOrThrow({ where: { workspaceId: s.ctx.workspaceId, campaignId: second.id, status: "QUEUED" } });
    const other = firstQueued.contactId === ana.id ? bo : ana;
    await db.contact.updateMany({ where: { id: other.id, workspaceId: s.ctx.workspaceId }, data: { optInStatus: "OPTED_OUT" } });
    await dispatchBatch(s.ctx.workspaceId, second.id);
    const skipped = await db.campaignRecipient.findFirstOrThrow({ where: { workspaceId: s.ctx.workspaceId, campaignId: second.id, contactId: other.id } });
    expect(skipped).toMatchObject({ status: "SKIPPED", skipReason: "Opted out" });
  });

  it("skips recipients with a missing value and no fallback", async () => {
    const s = await setup();
    await contact(s.ctx, s.list.id, null, "OPTED_IN");
    const input = utilityInput(s);
    input.variableMapping.body["1"] = { source: "field", field: "firstName", fallback: "" };
    const campaign = await createCampaign(s.ctx, input);
    await launchCampaign(s.ctx, campaign.id, null);
    await runCampaignTick();
    const { rows } = await listRecipients(s.ctx, campaign.id, "skipped");
    expect(rows[0]?.skipReason).toBe("No value for {{1}}");
  });

  it("pauses, resumes and cancels", async () => {
    const s = await setup();
    for (let i = 0; i < 3; i++) await contact(s.ctx, s.list.id, `C${i}`, "OPTED_IN");
    process.env.WHATSAPP_SEND_RATE_PER_SECOND = "0.1";
    const campaign = await createCampaign(s.ctx, utilityInput(s));
    await launchCampaign(s.ctx, campaign.id, null);
    await runCampaignTick();
    const count = () => db.message.count({ where: { workspaceId: s.ctx.workspaceId, campaignId: campaign.id } });
    expect(await count()).toBe(1);
    await deliverAll(s.ctx.workspaceId, campaign.id);

    await changeCampaignState(s.ctx, campaign.id, "pause");
    await runCampaignTick();
    expect(await count()).toBe(1);

    await changeCampaignState(s.ctx, campaign.id, "resume");
    await runCampaignTick();
    expect(await count()).toBe(2);
    await deliverAll(s.ctx.workspaceId, campaign.id);

    await changeCampaignState(s.ctx, campaign.id, "cancel");
    await runCampaignTick();
    expect(await count()).toBe(2);
    const c = await getCampaign(s.ctx, campaign.id);
    expect(c.status).toBe("CANCELLED");
    expect(c.stats.cancelled).toBe(1);
    await expect(changeCampaignState(s.ctx, campaign.id, "resume")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("waits for the scheduled time", async () => {
    const s = await setup();
    await contact(s.ctx, s.list.id, "Ana", "OPTED_IN");
    const campaign = await createCampaign(s.ctx, utilityInput(s));
    const at = new Date(Date.now() + 3600_000);
    await launchCampaign(s.ctx, campaign.id, at);
    await runCampaignTick();
    expect((await getCampaign(s.ctx, campaign.id)).status).toBe("SCHEDULED");
    await runCampaignTick(new Date(at.getTime() + 1000));
    expect((await getCampaign(s.ctx, campaign.id)).status).toBe("SENDING");
  });

  it("counts results from actual statuses and attributes replies", async () => {
    const s = await setup();
    const phone = "+16505551234";
    await contact(s.ctx, s.list.id, "Ana", "OPTED_IN", phone);
    await contact(s.ctx, s.list.id, "Ben", "OPTED_IN");
    const campaign = await createCampaign(s.ctx, utilityInput(s));
    await launchCampaign(s.ctx, campaign.id, null);
    await runCampaignTick();
    await deliverAll(s.ctx.workspaceId, campaign.id);
    const messages = await db.message.findMany({
      where: { workspaceId: s.ctx.workspaceId, campaignId: campaign.id },
      include: { contact: true },
    });
    const anaMsg = messages.find((m) => m.contact.normalizedPhoneNumber === phone)!;
    const benMsg = messages.find((m) => m.contact.normalizedPhoneNumber !== phone)!;
    const now = Math.floor(Date.now() / 1000);
    const hook = async (value: Record<string, unknown>) => {
      const raw = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ id: WABA_ID, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: PHONE_ID }, ...value } }] }],
      });
      await ingestMetaWebhook(raw, `sha256=${createHmac("sha256", "test-app-secret").update(raw).digest("hex")}`, "test-app-secret");
      for (const e of await systemDb.webhookEvent.findMany({ where: { status: "RECEIVED" } })) await processWebhookEvent(e.id);
    };
    await hook({ statuses: [{ id: anaMsg.whatsappMessageId, status: "read", timestamp: String(now), recipient_id: "16505551234" }] });
    await hook({
      statuses: [
        { id: benMsg.whatsappMessageId, status: "failed", timestamp: String(now), errors: [{ code: 131026, title: "Undeliverable" }] },
      ],
    });
    await hook({
      contacts: [{ profile: { name: "Ana" }, wa_id: "16505551234" }],
      messages: [{ from: "16505551234", id: "wamid.reply1", timestamp: String(now + 5), type: "text", text: { body: "Thanks!" } }],
    });
    const c = await getCampaign(s.ctx, campaign.id);
    expect(c.stats).toMatchObject({ sent: 1, delivered: 1, read: 1, failed: 1, replied: 1 });
    expect((await listRecipients(s.ctx, campaign.id, "failed")).total).toBe(1);
  });

  it("keeps campaigns inside their workspace", async () => {
    const s = await setup();
    const campaign = await createCampaign(s.ctx, utilityInput(s));
    const outsider = await ownerContext();
    await expect(getCampaign(outsider, campaign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(launchCampaign(outsider, campaign.id, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("schedule time zones", () => {
  it("converts workspace wall-clock time to UTC", () => {
    expect(zonedLocalToUtc("2026-10-02T09:30", "Asia/Kolkata")?.toISOString()).toBe("2026-10-02T04:00:00.000Z");
    expect(zonedLocalToUtc("2026-07-01T09:00", "America/New_York")?.toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedLocalToUtc("2026-12-01T09:00", "America/New_York")?.toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(zonedLocalToUtc("bad", "UTC")).toBeNull();
  });
});
