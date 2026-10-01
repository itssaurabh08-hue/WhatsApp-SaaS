import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, systemDb } from "@/server/db/client";
import { createContact } from "@/server/contacts/service";
import {
  addConversationNote,
  assignConversation,
  getConversation,
  sendReply,
  startConversation,
} from "@/server/inbox/service";
import { downloadInboundMedia } from "@/server/messaging/media";
import { deliverMessage, reconcileOutbound, RetryLaterError, UNCONFIRMED_AFTER_MS } from "@/server/messaging/outbound";
import { setWhatsAppProviderForTests } from "@/server/providers/whatsapp";
import { setStorageForTests, type StorageProvider } from "@/server/storage";
import { syncTemplates } from "@/server/templates/service";
import { ingestMetaWebhook } from "@/server/webhooks/meta-ingest";
import { processWebhookEvent } from "@/server/webhooks/meta-processor";
import { completeEmbeddedSignup } from "@/server/whatsapp/connection";
import { FakeMeta, happyMeta, metaError, PHONE_ID, WABA_ID, withMessaging } from "../support/fake-meta";
import { memberContext, ownerContext } from "../support/factories";

const SECRET = "test-app-secret";
const CUSTOMER = "16505551234";
const sign = (raw: string) => `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
const metadata = { display_phone_number: "15550783881", phone_number_id: PHONE_ID };

function webhook(value: Record<string, unknown>) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      { id: WABA_ID, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata, ...value } }] },
    ],
  });
}

async function deliverWebhook(value: Record<string, unknown>) {
  const raw = webhook(value);
  await ingestMetaWebhook(raw, sign(raw), SECRET);
  const events = await systemDb.webhookEvent.findMany({ where: { status: "RECEIVED" }, orderBy: { createdAt: "asc" } });
  for (const e of events) await processWebhookEvent(e.id);
}

const now = () => Math.floor(Date.now() / 1000);

function inboundText(id: string, text: string, ts = now()) {
  return {
    contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: CUSTOMER }],
    messages: [{ from: CUSTOMER, id, timestamp: String(ts), type: "text", text: { body: text } }],
  };
}

function statusUpdate(id: string, status: string, ts: number, extra: Record<string, unknown> = {}) {
  return { statuses: [{ id, status, timestamp: String(ts), recipient_id: CUSTOMER, ...extra }] };
}

class MemoryStorage implements StorageProvider {
  files = new Map<string, Buffer>();
  async put(key: string, data: Uint8Array) {
    this.files.set(key, Buffer.from(data));
  }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error("missing");
    return f;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

let fake: FakeMeta;

async function setup() {
  fake = withMessaging(happyMeta());
  setWhatsAppProviderForTests(null, fake.fetch);
  const ctx = await ownerContext();
  await completeEmbeddedSignup(ctx, { code: "AQB", wabaId: WABA_ID, phoneNumberId: PHONE_ID });
  const account = await db.whatsAppAccount.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId } });
  return { ctx, account };
}

async function conversationFor(workspaceId: string) {
  return db.conversation.findFirstOrThrow({ where: { workspaceId }, include: { contact: true } });
}

const sends = () => fake.callsTo("POST", new RegExp(`^/${PHONE_ID}/messages$`));

beforeEach(() => {
  setStorageForTests(new MemoryStorage());
});
afterEach(() => {
  setWhatsAppProviderForTests(null);
  setStorageForTests(null);
});

describe("incoming messages", () => {
  it("creates the contact, conversation and message once, even when Meta retries", async () => {
    const { ctx } = await setup();
    await deliverWebhook(inboundText("wamid.in1", "Hello, is my order ready?"));
    await deliverWebhook(inboundText("wamid.in1", "Hello, is my order ready?"));

    const conv = await conversationFor(ctx.workspaceId);
    expect(conv.contact.normalizedPhoneNumber).toBe(`+${CUSTOMER}`);
    expect(conv.contact.firstName).toBe("Sheena Nelson");
    expect(conv.contact.source).toBe("INBOUND");
    expect(conv.contact.optInStatus).toBe("UNKNOWN");
    expect(conv.unreadCount).toBe(1);
    expect(conv.lastInboundAt).not.toBeNull();
    expect(conv.lastMessagePreview).toBe("Hello, is my order ready?");
    const messages = await db.message.findMany({ where: { workspaceId: ctx.workspaceId }, include: { events: true } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ direction: "INBOUND", status: "RECEIVED", whatsappMessageId: "wamid.in1" });
    expect(messages[0]!.events.map((e) => e.type)).toEqual(["RECEIVED"]);
  });

  it("downloads incoming media into storage with a fresh URL", async () => {
    const { ctx, account } = await setup();
    await deliverWebhook({
      contacts: [{ profile: { name: "Sheena" }, wa_id: CUSTOMER }],
      messages: [
        {
          from: CUSTOMER,
          id: "wamid.img",
          timestamp: String(now()),
          type: "image",
          image: { caption: "Broken box", mime_type: "image/jpeg", sha256: "abc", id: "media123" },
        },
      ],
    });
    const media = await db.mediaObject.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId } });
    expect(media.status).toBe("PENDING");
    const result = await downloadInboundMedia({
      mediaObjectId: media.id,
      workspaceId: ctx.workspaceId,
      whatsappAccountId: account.id,
      finalAttempt: false,
    });
    expect(result).toBe("stored");
    const stored = await db.mediaObject.findFirstOrThrow({ where: { id: media.id, workspaceId: ctx.workspaceId } });
    expect(stored).toMatchObject({ status: "STORED", mimeType: "image/jpeg", size: 4 });
    const download = fake.calls.find((c) => c.path.startsWith("/whatsapp_business/attachments"));
    expect(download?.authorization).toMatch(/^Bearer /);
    const msg = await db.message.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId } });
    expect(msg).toMatchObject({ type: "image", body: "Broken box", mediaObjectId: media.id });
  });
});

describe("sending replies", () => {
  it("sends inside the 24-hour window exactly once, with our id for webhook matching", async () => {
    const { ctx } = await setup();
    await deliverWebhook(inboundText("wamid.in1", "Hi"));
    const conv = await conversationFor(ctx.workspaceId);
    const inbound = await db.message.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId } });

    const msg = await sendReply(ctx, {
      conversationId: conv.id,
      request: { kind: "text", text: "Yes, it ships today." },
      idempotencyKey: "k1",
      replyToMessageId: inbound.id,
    });
    expect(msg.status).toBe("QUEUED");
    // Same idempotency key: no second message.
    const again = await sendReply(ctx, {
      conversationId: conv.id,
      request: { kind: "text", text: "Yes, it ships today." },
      idempotencyKey: "k1",
    });
    expect(again.id).toBe(msg.id);

    expect(await deliverMessage(msg.id, { finalAttempt: false })).toBe("accepted");
    expect(await deliverMessage(msg.id, { finalAttempt: false })).toBe("skipped");
    expect(sends()).toHaveLength(1);
    expect(sends()[0]!.body).toMatchObject({
      messaging_product: "whatsapp",
      to: `+${CUSTOMER}`,
      type: "text",
      text: { body: "Yes, it ships today." },
      context: { message_id: "wamid.in1" },
      biz_opaque_callback_data: msg.id,
    });
    const saved = await db.message.findFirstOrThrow({ where: { id: msg.id, workspaceId: ctx.workspaceId } });
    expect(saved.status).toBe("ACCEPTED");
    expect(saved.whatsappMessageId).toMatch(/^wamid\.fake/);
  });

  it("refuses free-form messages outside the window but allows approved templates", async () => {
    const { ctx, account } = await setup();
    const old = now() - 25 * 3600;
    await deliverWebhook(inboundText("wamid.old", "Hi", old));
    const conv = await conversationFor(ctx.workspaceId);
    await expect(
      sendReply(ctx, { conversationId: conv.id, request: { kind: "text", text: "Hello?" } }),
    ).rejects.toMatchObject({
      userMessage: expect.stringContaining("24 hours"),
    });
    expect(await db.message.count({ where: { workspaceId: ctx.workspaceId, direction: "OUTBOUND" } })).toBe(0);

    await syncTemplates(ctx, account.id);
    const template = await db.template.findFirstOrThrow({
      where: { workspaceId: ctx.workspaceId, name: "order_update" },
    });
    await expect(
      sendReply(ctx, {
        conversationId: conv.id,
        request: { kind: "template", templateId: template.id, values: { body: { "1": "Sheena" } } },
      }),
    ).rejects.toMatchObject({ userMessage: expect.stringContaining("{{2}}") });
    const msg = await sendReply(ctx, {
      conversationId: conv.id,
      request: { kind: "template", templateId: template.id, values: { body: { "1": "Sheena", "2": "A-77" } } },
    });
    expect(msg.body).toBe("Hi Sheena, order A-77 has shipped.");
    await deliverMessage(msg.id, { finalAttempt: false });
    expect(sends()[0]!.body).toMatchObject({
      type: "template",
      template: {
        name: "order_update",
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Sheena" },
              { type: "text", text: "A-77" },
            ],
          },
        ],
      },
    });
  });

  it("never sends marketing templates to opted-out contacts", async () => {
    const { ctx, account } = await setup();
    await syncTemplates(ctx, account.id);
    const marketing = await db.template.findFirstOrThrow({
      where: { workspaceId: ctx.workspaceId, name: "spring_sale" },
    });
    const contact = await createContact(ctx, {
      phoneNumber: `+${CUSTOMER}`,
      firstName: "Ana",
      lastName: null,
      email: null,
      company: null,
      country: null,
      optInStatus: "OPTED_OUT",
      optInSource: null,
      customFields: {},
    });
    const request = {
      kind: "template" as const,
      templateId: marketing.id,
      values: { body: { first_name: "Ana" }, buttons: { "0": "spring sale" } },
    };
    await expect(
      startConversation(ctx, { contactId: contact.id, whatsappAccountId: account.id, request }),
    ).rejects.toMatchObject({
      userMessage: expect.stringContaining("opted out"),
    });

    // Opted in when queued, opted out before delivery: the delivery gate stops it.
    await db.contact.updateMany({
      where: { id: contact.id, workspaceId: ctx.workspaceId },
      data: { optInStatus: "OPTED_IN" },
    });
    const msg = await startConversation(ctx, { contactId: contact.id, whatsappAccountId: account.id, request });
    await db.contact.updateMany({
      where: { id: contact.id, workspaceId: ctx.workspaceId },
      data: { optInStatus: "OPTED_OUT" },
    });
    expect(await deliverMessage(msg.id, { finalAttempt: false })).toBe("failed");
    expect(sends()).toHaveLength(0);
    const saved = await db.message.findFirstOrThrow({ where: { id: msg.id, workspaceId: ctx.workspaceId } });
    expect(saved.status).toBe("FAILED");
  });

  it("builds named parameters and percent-encodes URL button values", async () => {
    const { ctx, account } = await setup();
    await syncTemplates(ctx, account.id);
    const marketing = await db.template.findFirstOrThrow({
      where: { workspaceId: ctx.workspaceId, name: "spring_sale" },
    });
    const contact = await createContact(ctx, {
      phoneNumber: `+${CUSTOMER}`,
      firstName: "Ana",
      lastName: null,
      email: null,
      company: null,
      country: null,
      optInStatus: "OPTED_IN",
      optInSource: null,
      customFields: {},
    });
    const msg = await startConversation(ctx, {
      contactId: contact.id,
      whatsappAccountId: account.id,
      request: {
        kind: "template",
        templateId: marketing.id,
        values: { body: { first_name: "Ana" }, buttons: { "0": "New York" } },
      },
    });
    await deliverMessage(msg.id, { finalAttempt: false });
    expect(sends()[0]!.body).toMatchObject({
      template: {
        components: [
          { type: "body", parameters: [{ type: "text", parameter_name: "first_name", text: "Ana" }] },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", parameter_name: "1", text: "New%20York" }],
          },
        ],
      },
    });
  });

  it("retries only when Meta did not accept the message", async () => {
    const { ctx } = await setup();
    await deliverWebhook(inboundText("wamid.in1", "Hi"));
    const conv = await conversationFor(ctx.workspaceId);
    fake.on("POST", new RegExp(`^/${PHONE_ID}/messages$`), () => metaError(130429, "rate limit", 400));
    const msg = await sendReply(ctx, { conversationId: conv.id, request: { kind: "text", text: "One" } });
    await expect(deliverMessage(msg.id, { finalAttempt: false })).rejects.toBeInstanceOf(RetryLaterError);
    let saved = await db.message.findFirstOrThrow({ where: { id: msg.id, workspaceId: ctx.workspaceId } });
    expect(saved.status).toBe("QUEUED");
    expect(await deliverMessage(msg.id, { finalAttempt: true })).toBe("failed");
    saved = await db.message.findFirstOrThrow({ where: { id: msg.id, workspaceId: ctx.workspaceId } });
    expect(saved).toMatchObject({ status: "FAILED", errorCode: 130429 });
  });

  it("does not resend when the outcome is unknown, and reconciles from the webhook", async () => {
    const { ctx } = await setup();
    await deliverWebhook(inboundText("wamid.in1", "Hi"));
    const conv = await conversationFor(ctx.workspaceId);
    const timeoutFetch = fake.fetch;
    setWhatsAppProviderForTests(null, async (input, init) => {
      if (input.includes(`/${PHONE_ID}/messages`)) {
        await timeoutFetch(input, init); // Meta received it...
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); // ...but we never heard back
      }
      return timeoutFetch(input, init);
    });
    const msg = await sendReply(ctx, { conversationId: conv.id, request: { kind: "text", text: "Hello" } });
    expect(await deliverMessage(msg.id, { finalAttempt: false })).toBe("uncertain");
    expect(await deliverMessage(msg.id, { finalAttempt: false })).toBe("skipped");
    expect(sends()).toHaveLength(1);

    // An hour later with no webhook: marked failed, never re-sent.
    await systemDb.message.update({
      where: { id: msg.id },
      data: { updatedAt: new Date(Date.now() - UNCONFIRMED_AFTER_MS - 1000) },
    });
    expect((await reconcileOutbound()).failed).toBe(1);
    let saved = await db.message.findFirstOrThrow({ where: { id: msg.id, workspaceId: ctx.workspaceId } });
    expect(saved.status).toBe("FAILED");

    // Meta's delivery webhook (matched through biz_opaque_callback_data) is the truth.
    await deliverWebhook(statusUpdate("wamid.late", "delivered", now(), { biz_opaque_callback_data: msg.id }));
    saved = await db.message.findFirstOrThrow({ where: { id: msg.id, workspaceId: ctx.workspaceId } });
    expect(saved).toMatchObject({ status: "DELIVERED", whatsappMessageId: "wamid.late", errorMessage: null });
  });

  it("records an opt-out when Meta reports error 131050, and needs reconnect on auth errors", async () => {
    const { ctx, account } = await setup();
    await syncTemplates(ctx, account.id);
    const marketing = await db.template.findFirstOrThrow({
      where: { workspaceId: ctx.workspaceId, name: "spring_sale" },
    });
    const contact = await createContact(ctx, {
      phoneNumber: `+${CUSTOMER}`,
      firstName: "Ana",
      lastName: null,
      email: null,
      company: null,
      country: null,
      optInStatus: "OPTED_IN",
      optInSource: null,
      customFields: {},
    });
    fake.on("POST", new RegExp(`^/${PHONE_ID}/messages$`), () => metaError(131050, "stopped marketing"));
    const request = {
      kind: "template" as const,
      templateId: marketing.id,
      values: { body: { first_name: "Ana" }, buttons: { "0": "x" } },
    };
    const msg = await startConversation(ctx, { contactId: contact.id, whatsappAccountId: account.id, request });
    expect(await deliverMessage(msg.id, { finalAttempt: false })).toBe("failed");
    const c = await db.contact.findFirstOrThrow({ where: { id: contact.id, workspaceId: ctx.workspaceId } });
    expect(c.optInStatus).toBe("OPTED_OUT");

    await db.contact.updateMany({
      where: { id: contact.id, workspaceId: ctx.workspaceId },
      data: { optInStatus: "OPTED_IN" },
    });
    fake.on("POST", new RegExp(`^/${PHONE_ID}/messages$`), () => metaError(190, "expired", 401));
    const msg2 = await startConversation(ctx, { contactId: contact.id, whatsappAccountId: account.id, request });
    await deliverMessage(msg2.id, { finalAttempt: false });
    const acc = await db.whatsAppAccount.findFirstOrThrow({ where: { id: account.id, workspaceId: ctx.workspaceId } });
    expect(acc.status).toBe("NEEDS_RECONNECT");
  });
});

describe("delivery statuses", () => {
  async function accepted() {
    const s = await setup();
    await deliverWebhook(inboundText("wamid.in1", "Hi"));
    const conv = await conversationFor(s.ctx.workspaceId);
    const msg = await sendReply(s.ctx, { conversationId: conv.id, request: { kind: "text", text: "Hello" } });
    await deliverMessage(msg.id, { finalAttempt: false });
    const saved = await db.message.findFirstOrThrow({ where: { id: msg.id, workspaceId: s.ctx.workspaceId } });
    return { ...s, msg: saved, wamid: saved.whatsappMessageId! };
  }

  it("moves forward only; read implies delivered", async () => {
    const { ctx, msg, wamid } = await accepted();
    const t = now();
    await deliverWebhook(statusUpdate(wamid, "read", t + 2));
    await deliverWebhook(statusUpdate(wamid, "sent", t));
    await deliverWebhook(statusUpdate(wamid, "delivered", t + 1));
    const saved = await db.message.findFirstOrThrow({
      where: { id: msg.id, workspaceId: ctx.workspaceId },
      include: { events: true },
    });
    expect(saved.status).toBe("READ");
    expect(saved.readAt).not.toBeNull();
    expect(saved.deliveredAt).not.toBeNull();
    expect(saved.sentAt).not.toBeNull();
    expect(saved.events.map((e) => e.type).sort()).toEqual(["ACCEPTED", "DELIVERED", "QUEUED", "READ", "SENT"]);
  });

  it("records failures with a readable reason but never after delivery", async () => {
    const { ctx, msg, wamid } = await accepted();
    const failed = { errors: [{ code: 131026, title: "Message undeliverable", message: "Message undeliverable" }] };
    await deliverWebhook(statusUpdate(wamid, "failed", now(), failed));
    let saved = await db.message.findFirstOrThrow({ where: { id: msg.id, workspaceId: ctx.workspaceId } });
    expect(saved).toMatchObject({ status: "FAILED", errorCode: 131026 });
    expect(saved.errorMessage).toContain("could not deliver");
    // A delivered message is never turned into a failure.
    const conv = await conversationFor(ctx.workspaceId);
    const second = await sendReply(ctx, { conversationId: conv.id, request: { kind: "text", text: "Second" } });
    await deliverMessage(second.id, { finalAttempt: false });
    const secondWamid = (await db.message.findFirstOrThrow({ where: { id: second.id, workspaceId: ctx.workspaceId } }))
      .whatsappMessageId!;
    await deliverWebhook(statusUpdate(secondWamid, "delivered", now()));
    await deliverWebhook(statusUpdate(secondWamid, "failed", now() + 1, failed));
    saved = await db.message.findFirstOrThrow({ where: { id: second.id, workspaceId: ctx.workspaceId } });
    expect(saved.status).toBe("DELIVERED");
  });
});

describe("inbox rules", () => {
  it("keeps internal notes out of the send path", async () => {
    const { ctx } = await setup();
    await deliverWebhook(inboundText("wamid.in1", "Hi"));
    const conv = await conversationFor(ctx.workspaceId);
    await addConversationNote(ctx, conv.id, "SECRET-NOTE customer is VIP");
    expect(await db.message.count({ where: { workspaceId: ctx.workspaceId, body: { contains: "SECRET-NOTE" } } })).toBe(
      0,
    );
    expect(JSON.stringify(fake.calls.map((c) => c.body))).not.toContain("SECRET-NOTE");
    expect(await db.conversationNote.count({ where: { workspaceId: ctx.workspaceId } })).toBe(1);
  });

  it("enforces roles and workspace isolation", async () => {
    const { ctx } = await setup();
    await deliverWebhook(inboundText("wamid.in1", "Hi"));
    const conv = await conversationFor(ctx.workspaceId);
    const analyst = await memberContext(ctx, "ANALYST");
    const agent = await memberContext(ctx, "AGENT");
    await expect(
      sendReply(analyst, { conversationId: conv.id, request: { kind: "text", text: "x" } }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(assignConversation(ctx, conv.id, analyst.user.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await assignConversation(ctx, conv.id, agent.user.id);
    expect((await getConversation(agent, conv.id)).assignedUserId).toBe(agent.user.id);
    await sendReply(agent, { conversationId: conv.id, request: { kind: "text", text: "On it" } });

    const outsider = await ownerContext();
    await expect(getConversation(outsider, conv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      sendReply(outsider, { conversationId: conv.id, request: { kind: "text", text: "x" } }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
