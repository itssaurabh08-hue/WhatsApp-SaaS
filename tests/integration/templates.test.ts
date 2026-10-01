import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { templateDraftSchema } from "@/lib/templates";
import { db, systemDb } from "@/server/db/client";
import { setWhatsAppProviderForTests } from "@/server/providers/whatsapp";
import { createTemplate, deleteTemplate, listTemplates, syncTemplates } from "@/server/templates/service";
import { ingestMetaWebhook } from "@/server/webhooks/meta-ingest";
import { processWebhookEvent } from "@/server/webhooks/meta-processor";
import { completeEmbeddedSignup } from "@/server/whatsapp/connection";
import { happyMeta, metaError, PHONE_ID, WABA_ID, withMessaging, type FakeMeta } from "../support/fake-meta";
import { memberContext, ownerContext } from "../support/factories";

let fake: FakeMeta;

async function setup() {
  fake = withMessaging(happyMeta());
  setWhatsAppProviderForTests(null, fake.fetch);
  const ctx = await ownerContext();
  await completeEmbeddedSignup(ctx, { code: "AQB", wabaId: WABA_ID, phoneNumberId: PHONE_ID });
  const account = await db.whatsAppAccount.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId } });
  return { ctx, account };
}

function draft(accountId: string, overrides: Record<string, unknown> = {}) {
  return templateDraftSchema.parse({
    whatsappAccountId: accountId,
    name: "order_confirmation",
    language: "en_US",
    category: "UTILITY",
    parameterFormat: "POSITIONAL",
    headerText: "Order {{1}}",
    body: "Hi {{1}}! Your order {{2}} is confirmed.",
    footer: "Thanks for shopping",
    buttons: [
      { type: "URL", text: "Track", url: "https://shop.example.com/track/{{1}}", example: "A1" },
      { type: "QUICK_REPLY", text: "Stop updates" },
    ],
    examples: { header: { "1": "A1" }, body: { "1": "Pablo", "2": "860198" } },
    ...overrides,
  });
}

async function templateWebhook(value: Record<string, unknown>) {
  const raw = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: WABA_ID, changes: [{ field: "message_template_status_update", value }] }],
  });
  const sig = `sha256=${createHmac("sha256", "test-app-secret").update(raw).digest("hex")}`;
  await ingestMetaWebhook(raw, sig, "test-app-secret");
  for (const e of await systemDb.webhookEvent.findMany({ where: { status: "RECEIVED" } }))
    await processWebhookEvent(e.id);
}

afterEach(() => setWhatsAppProviderForTests(null));

describe("templates", () => {
  it("submits a template to Meta in the documented format and tracks its review", async () => {
    const { ctx, account } = await setup();
    const t = await createTemplate(ctx, draft(account.id));
    expect(t).toMatchObject({ status: "PENDING", providerTemplateId: "546151681022936", businessAccountId: WABA_ID });
    const call = fake.callsTo("POST", new RegExp(`^/${WABA_ID}/message_templates$`))[0]!;
    expect(call.body).toEqual({
      name: "order_confirmation",
      language: "en_US",
      category: "UTILITY",
      parameter_format: "POSITIONAL",
      components: [
        { type: "HEADER", format: "TEXT", text: "Order {{1}}", example: { header_text: ["A1"] } },
        {
          type: "BODY",
          text: "Hi {{1}}! Your order {{2}} is confirmed.",
          example: { body_text: [["Pablo", "860198"]] },
        },
        { type: "FOOTER", text: "Thanks for shopping" },
        {
          type: "BUTTONS",
          buttons: [
            { type: "QUICK_REPLY", text: "Stop updates" },
            { type: "URL", text: "Track", url: "https://shop.example.com/track/{{1}}", example: ["A1"] },
          ],
        },
      ],
    });

    await templateWebhook({
      event: "REJECTED",
      message_template_id: 546151681022936,
      message_template_name: "order_confirmation",
      message_template_language: "en-US",
      reason: "INVALID_FORMAT",
      message_template_category: "UTILITY",
      rejection_info: { reason: "Parameters are next to each other.", recommendation: "Add text between them." },
    });
    let saved = await db.template.findFirstOrThrow({ where: { id: t.id, workspaceId: ctx.workspaceId } });
    expect(saved).toMatchObject({ status: "REJECTED", rejectionReason: "Parameters are next to each other." });

    await templateWebhook({ event: "APPROVED", message_template_id: 546151681022936, reason: "NONE" });
    saved = await db.template.findFirstOrThrow({ where: { id: t.id, workspaceId: ctx.workspaceId } });
    expect(saved).toMatchObject({ status: "APPROVED", rejectionReason: null });
  });

  it("rejects duplicates and shows Meta's validation message", async () => {
    const { ctx, account } = await setup();
    await createTemplate(ctx, draft(account.id));
    await expect(createTemplate(ctx, draft(account.id))).rejects.toMatchObject({ code: "CONFLICT" });
    fake.on("POST", new RegExp(`^/${WABA_ID}/message_templates$`), () => metaError(100, "Invalid parameter"));
    await expect(createTemplate(ctx, draft(account.id, { name: "other_name" }))).rejects.toMatchObject({
      userMessage: expect.stringContaining("Invalid parameter"),
    });
  });

  it("imports templates from Meta and deletes them in Meta", async () => {
    const { ctx, account } = await setup();
    expect(await syncTemplates(ctx, account.id)).toMatchObject({ count: 2 });
    expect(await syncTemplates(ctx, account.id)).toMatchObject({ count: 2 });
    const { templates, tabCounts } = await listTemplates(ctx, { tab: "approved" });
    expect(templates.map((t) => t.name).sort()).toEqual(["order_update", "spring_sale"]);
    expect(tabCounts.approved).toBe(2);
    const named = templates.find((t) => t.name === "spring_sale")!;
    expect(named.parameterFormat).toBe("NAMED");

    await deleteTemplate(ctx, named.id);
    const del = fake.callsTo("DELETE", new RegExp(`^/${WABA_ID}/message_templates$`))[0]!;
    expect(del.query.get("name")).toBe("spring_sale");
    expect(del.query.get("hsm_id")).toBe("1002");
    expect(await db.template.count({ where: { workspaceId: ctx.workspaceId } })).toBe(1);
  });

  it("lets only managers create templates", async () => {
    const { ctx, account } = await setup();
    const agent = await memberContext(ctx, "AGENT");
    await expect(createTemplate(agent, draft(account.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listTemplates(agent)).templates).toEqual([]);
  });
});
