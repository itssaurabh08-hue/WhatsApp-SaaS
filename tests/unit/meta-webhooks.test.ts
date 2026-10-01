import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeMetaWebhook,
  verifyMetaHandshake,
  verifyMetaSignature,
} from "@/server/providers/whatsapp/meta/webhooks";

const sign = (body: string, secret = "s3cret") => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("webhook signature", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  it("accepts a correct X-Hub-Signature-256", () => {
    expect(verifyMetaSignature(body, sign(body), "s3cret")).toBe(true);
  });
  it("rejects wrong secret, modified body, missing or malformed header", () => {
    expect(verifyMetaSignature(body, sign(body, "other"), "s3cret")).toBe(false);
    expect(verifyMetaSignature(body + " ", sign(body), "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, null, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=abc", "s3cret")).toBe(false);
  });
});

describe("verification handshake", () => {
  it("echoes the challenge only for subscribe with the right token", () => {
    const ok = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "tok",
      "hub.challenge": "1158201444",
    });
    expect(verifyMetaHandshake(ok, "tok")).toBe("1158201444");
    expect(
      verifyMetaHandshake(new URLSearchParams({ ...Object.fromEntries(ok), "hub.verify_token": "bad" }), "tok"),
    ).toBeNull();
    expect(
      verifyMetaHandshake(new URLSearchParams({ ...Object.fromEntries(ok), "hub.mode": "unsubscribe" }), "tok"),
    ).toBeNull();
  });
});

const inbound = (id: string) => ({
  from: "16505551234",
  id,
  timestamp: "1749416383",
  type: "text",
  text: { body: "hi" },
});
const status = (id: string, s: string) => ({ id, status: s, timestamp: "1750263773", recipient_id: "16505551234" });
const delivery = (value: Record<string, unknown>, field = "messages") => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA1",
      changes: [
        {
          field,
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550783881", phone_number_id: "PHONE1" },
            ...value,
          },
        },
      ],
    },
  ],
});

describe("normalizeMetaWebhook", () => {
  it("splits batched messages and statuses into individually keyed changes", () => {
    const changes = normalizeMetaWebhook(
      delivery({ messages: [inbound("wamid.A"), inbound("wamid.B")], statuses: [status("wamid.C", "delivered")] }),
    );
    expect(changes.map((c) => c.dedupeKey)).toEqual([
      "msg:wamid.A",
      "msg:wamid.B",
      "status:wamid.C:delivered:1750263773",
    ]);
    expect(changes[0]).toMatchObject({ field: "messages", businessAccountId: "WABA1", phoneNumberId: "PHONE1" });
    expect((changes[1]!.value.messages as unknown[]).length).toBe(1);
  });

  it("produces the same keys when Meta re-batches a retry", () => {
    const batched = normalizeMetaWebhook(delivery({ messages: [inbound("wamid.A"), inbound("wamid.B")] })).map(
      (c) => c.dedupeKey,
    );
    const single = [
      ...normalizeMetaWebhook(delivery({ messages: [inbound("wamid.B")] })),
      ...normalizeMetaWebhook(delivery({ messages: [inbound("wamid.A")] })),
    ].map((c) => c.dedupeKey);
    expect(single.sort()).toEqual(batched.sort());
  });

  it("distinguishes sent/delivered/read for the same message", () => {
    const keys = ["sent", "delivered", "read"].map(
      (s) => normalizeMetaWebhook(delivery({ statuses: [status("wamid.X", s)] }))[0]!.dedupeKey,
    );
    expect(new Set(keys).size).toBe(3);
  });

  it("hashes other fields and ignores unrelated objects", () => {
    const acc = normalizeMetaWebhook({
      object: "whatsapp_business_account",
      entry: [{ id: "WABA1", changes: [{ field: "account_update", value: { event: "PARTNER_APP_UNINSTALLED" } }] }],
    });
    expect(acc[0]!.dedupeKey).toMatch(/^account_update:WABA1:[0-9a-f]{64}$/);
    expect(normalizeMetaWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(normalizeMetaWebhook(null)).toEqual([]);
  });
});
