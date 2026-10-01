import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { classifyMetaError, MetaApiError } from "@/server/providers/whatsapp/meta/errors";
import { MetaCloudProvider } from "@/server/providers/whatsapp/meta/provider";
import { formatMessagingLimit, formatQuality } from "@/lib/whatsapp-display";
import { BUSINESS_TOKEN, FakeMeta, happyMeta, metaError, PHONE_ID, WABA_ID } from "../support/fake-meta";

const recorded: unknown[] = [];
function provider(fake: FakeMeta) {
  return new MetaCloudProvider({
    appId: "APP",
    appSecret: "SECRET",
    apiVersion: "v25.0",
    fetch: fake.fetch,
    recordCall: async (entry) => void recorded.push(entry),
  });
}

describe("Meta provider", () => {
  it("exchanges the signup code using app id and secret (JSON or plain-text response)", async () => {
    const fake = happyMeta();
    expect(await provider(fake).exchangeSignupCode("CODE", {})).toBe(BUSINESS_TOKEN);
    const call = fake.callsTo("GET", /oauth/)[0]!;
    expect(call.query.get("client_id")).toBe("APP");
    expect(call.query.get("client_secret")).toBe("SECRET");
    expect(call.query.get("code")).toBe("CODE");

    const plain = new FakeMeta().on("GET", /oauth/, () => ({ text: BUSINESS_TOKEN }));
    expect(await provider(plain).exchangeSignupCode("CODE", {})).toBe(BUSINESS_TOKEN);
  });

  it("sends bearer token and appsecret_proof on authenticated calls", async () => {
    const fake = happyMeta();
    await provider(fake).registerPhoneNumber(PHONE_ID, "123456", BUSINESS_TOKEN, {});
    const call = fake.callsTo("POST", /register/)[0]!;
    expect(call.authorization).toBe(`Bearer ${BUSINESS_TOKEN}`);
    expect(call.query.get("appsecret_proof")).toBe(createHmac("sha256", "SECRET").update(BUSINESS_TOKEN).digest("hex"));
    expect(call.body).toEqual({ messaging_product: "whatsapp", pin: "123456" });
  });

  it("maps phone number details including the messaging limit", async () => {
    const details = await provider(happyMeta()).getPhoneNumber(PHONE_ID, BUSINESS_TOKEN, {});
    expect(details).toMatchObject({
      qualityRating: "GREEN",
      messagingLimit: "TIER_250",
      nameStatus: "APPROVED",
      throughputLevel: "STANDARD",
    });
  });

  it("throws MetaApiError with Meta's code and a user-safe message", async () => {
    const fake = happyMeta().on("POST", new RegExp(`^/${WABA_ID}/subscribed_apps$`), () =>
      metaError(190, "Error validating access token", 401),
    );
    const err = await provider(fake)
      .subscribeAppToWaba(WABA_ID, BUSINESS_TOKEN, {})
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).code).toBe(190);
    expect((err as MetaApiError).info.category).toBe("auth");
    expect((err as MetaApiError).info.userMessage).not.toMatch(/190|OAuth/);
  });

  it("records call metadata without the token or app secret", async () => {
    recorded.length = 0;
    await provider(happyMeta()).exchangeSignupCode("CODE", { workspaceId: "ws1" });
    expect(recorded).toHaveLength(1);
    const text = JSON.stringify(recorded);
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain(BUSINESS_TOKEN);
    expect(text).not.toContain("CODE");
    expect(recorded[0]).toMatchObject({
      operation: "exchange_signup_code",
      path: "/oauth/access_token",
      success: true,
      workspaceId: "ws1",
    });
  });

  it("treats network failures as retryable", async () => {
    const failing = provider(new FakeMeta());
    (failing.client as unknown as { fetchImpl: () => Promise<Response> }).fetchImpl = () =>
      Promise.reject(new Error("ECONNRESET"));
    const err = (await failing.getPhoneNumber(PHONE_ID, BUSINESS_TOKEN, {}).catch((e: unknown) => e)) as MetaApiError;
    expect(err.info).toMatchObject({ category: "network", retryable: true });
  });
});

describe("error classification", () => {
  it("classifies documented codes", () => {
    expect(classifyMetaError(131047).category).toBe("window");
    expect(classifyMetaError(131050)).toMatchObject({ category: "opt_out", retryable: false });
    expect(classifyMetaError(130429)).toMatchObject({ category: "rate_limit", retryable: true });
    expect(classifyMetaError(250).category).toBe("auth");
    expect(classifyMetaError(999999).category).toBe("unknown");
  });
});

describe("display helpers", () => {
  it("formats limits and quality", () => {
    expect(formatMessagingLimit("TIER_2K")).toBe("2,000 customers per 24 hours");
    expect(formatMessagingLimit("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(formatQuality("YELLOW").label).toBe("Medium");
  });
});
