import "server-only";
import type { PhoneNumberDetails, ProviderCallContext, WhatsAppProvider } from "../types";
import { GraphClient, type ApiCallRecord, type FetchLike } from "./graph-client";

const PHONE_FIELDS = [
  "id",
  "display_phone_number",
  "verified_name",
  "quality_rating",
  "name_status",
  "code_verification_status",
  "whatsapp_business_manager_messaging_limit",
  "throughput",
].join(",");

interface MetaPhoneNumber {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  name_status?: string;
  code_verification_status?: string;
  whatsapp_business_manager_messaging_limit?: unknown;
  throughput?: { level?: string } | string;
}

/** The limit field's exact shape is not fixed in the reference; keep a readable string. */
function describeLimit(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    const candidate = v.current_limit ?? v.limit ?? v.tier ?? v.value;
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
    return JSON.stringify(value).slice(0, 200);
  }
  return null;
}

function toDetails(p: MetaPhoneNumber): PhoneNumberDetails {
  return {
    phoneNumberId: p.id,
    displayPhoneNumber: p.display_phone_number ?? null,
    verifiedName: p.verified_name ?? null,
    qualityRating: p.quality_rating ?? null,
    nameStatus: p.name_status ?? null,
    codeVerificationStatus: p.code_verification_status ?? null,
    messagingLimit: describeLimit(p.whatsapp_business_manager_messaging_limit),
    throughputLevel: typeof p.throughput === "string" ? p.throughput : (p.throughput?.level ?? null),
  };
}

export class MetaCloudProvider implements WhatsAppProvider {
  readonly client: GraphClient;

  constructor(
    private readonly config: {
      appId: string;
      appSecret: string;
      apiVersion: string;
      fetch?: FetchLike;
      baseUrl?: string;
      recordCall?: (entry: ApiCallRecord) => Promise<void>;
    },
  ) {
    this.client = new GraphClient(config);
  }

  async exchangeSignupCode(code: string, ctx: ProviderCallContext): Promise<string> {
    // Documented response is the token; Graph commonly returns {"access_token": ...}. Accept both.
    const raw = await this.client.request<string>(
      "GET",
      "/oauth/access_token",
      { ...ctx, operation: "exchange_signup_code" },
      {
        query: { client_id: this.config.appId, client_secret: this.config.appSecret, code },
        raw: true,
      },
    );
    let token: unknown = raw.trim();
    try {
      const json = JSON.parse(raw) as { access_token?: string };
      token = json.access_token;
    } catch {
      // plain-text token
    }
    if (typeof token !== "string" || token.length < 20 || /\s/.test(token)) {
      throw new Error("Meta returned an unexpected token exchange response");
    }
    return token;
  }

  async listPhoneNumbers(wabaId: string, accessToken: string, ctx: ProviderCallContext) {
    const res = await this.client.request<{ data?: MetaPhoneNumber[] }>(
      "GET",
      `/${encodeURIComponent(wabaId)}/phone_numbers`,
      {
        ...ctx,
        operation: "list_phone_numbers",
        accessToken,
      },
      { query: { fields: "id,display_phone_number,verified_name,quality_rating" } },
    );
    return (res.data ?? []).map(toDetails);
  }

  async subscribeAppToWaba(wabaId: string, accessToken: string, ctx: ProviderCallContext) {
    await this.client.request("POST", `/${encodeURIComponent(wabaId)}/subscribed_apps`, {
      ...ctx,
      operation: "subscribe_app",
      accessToken,
    });
  }

  async unsubscribeAppFromWaba(wabaId: string, accessToken: string, ctx: ProviderCallContext) {
    await this.client.request("DELETE", `/${encodeURIComponent(wabaId)}/subscribed_apps`, {
      ...ctx,
      operation: "unsubscribe_app",
      accessToken,
    });
  }

  async registerPhoneNumber(phoneNumberId: string, pin: string, accessToken: string, ctx: ProviderCallContext) {
    await this.client.request(
      "POST",
      `/${encodeURIComponent(phoneNumberId)}/register`,
      { ...ctx, operation: "register_phone", accessToken },
      {
        body: { messaging_product: "whatsapp", pin },
      },
    );
  }

  async getPhoneNumber(phoneNumberId: string, accessToken: string, ctx: ProviderCallContext) {
    const res = await this.client.request<MetaPhoneNumber>(
      "GET",
      `/${encodeURIComponent(phoneNumberId)}`,
      {
        ...ctx,
        operation: "get_phone_number",
        accessToken,
      },
      { query: { fields: PHONE_FIELDS } },
    );
    return toDetails(res);
  }
}
