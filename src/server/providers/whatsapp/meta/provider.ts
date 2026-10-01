import "server-only";
import type { MetaTemplateComponent } from "@/lib/templates";
import type {
  CreateTemplateInput,
  MediaInfo,
  PhoneNumberDetails,
  ProviderCallContext,
  ProviderTemplate,
  SendMessageInput,
  SendMessageResult,
  UploadFile,
  WhatsAppProvider,
} from "../types";
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

const TEMPLATE_FIELDS = "id,name,language,status,category,parameter_format,components,rejected_reason";

interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status?: string;
  category?: string;
  parameter_format?: string;
  components?: MetaTemplateComponent[];
  rejected_reason?: string;
}

function toTemplate(t: MetaTemplate): ProviderTemplate {
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    status: t.status ?? "UNKNOWN",
    category: t.category ?? "UTILITY",
    parameterFormat: t.parameter_format?.toUpperCase() === "NAMED" ? "NAMED" : "POSITIONAL",
    components: t.components ?? [],
    rejectionReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
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

  async sendMessage(
    input: SendMessageInput,
    accessToken: string,
    ctx: ProviderCallContext,
  ): Promise<SendMessageResult> {
    const c = input.content;
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: c.type,
    };
    if (c.type === "text") body.text = { body: c.text, preview_url: c.previewUrl ?? false };
    else if (c.type === "template") {
      body.template = {
        name: c.name,
        language: { code: c.language },
        ...(c.components.length > 0 ? { components: c.components } : {}),
      };
    } else {
      const media: Record<string, unknown> = { id: c.mediaId };
      // Captions are not supported on audio and sticker messages.
      if (c.caption && ["image", "video", "document"].includes(c.type)) media.caption = c.caption;
      if (c.type === "document" && c.fileName) media.filename = c.fileName;
      body[c.type] = media;
    }
    if (input.contextMessageId) body.context = { message_id: input.contextMessageId };
    if (input.callbackData) body.biz_opaque_callback_data = input.callbackData.slice(0, 512);
    const res = await this.client.request<{ messages?: { id?: string; message_status?: string }[] }>(
      "POST",
      `/${encodeURIComponent(input.phoneNumberId)}/messages`,
      { ...ctx, operation: `send_${c.type}`, accessToken },
      { body },
    );
    const id = res.messages?.[0]?.id;
    if (!id) throw new Error("Meta accepted the request but returned no message id");
    return { messageId: id, messageStatus: res.messages?.[0]?.message_status ?? null };
  }

  async uploadMedia(phoneNumberId: string, file: UploadFile, accessToken: string, ctx: ProviderCallContext) {
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", file.mimeType);
    form.set("file", new Blob([file.data as BlobPart], { type: file.mimeType }), file.fileName);
    const res = await this.client.request<{ id?: string }>(
      "POST",
      `/${encodeURIComponent(phoneNumberId)}/media`,
      { ...ctx, operation: "upload_media", accessToken },
      { form },
    );
    if (!res.id) throw new Error("Meta returned no media id");
    return res.id;
  }

  async getMediaInfo(mediaId: string, accessToken: string, ctx: ProviderCallContext): Promise<MediaInfo> {
    const res = await this.client.request<{ url?: string; mime_type?: string; sha256?: string; file_size?: unknown }>(
      "GET",
      `/${encodeURIComponent(mediaId)}`,
      { ...ctx, operation: "get_media_url", accessToken },
    );
    if (!res.url) throw new Error("Meta returned no media URL");
    const size = Number(res.file_size);
    return {
      url: res.url,
      mimeType: res.mime_type ?? null,
      sha256: res.sha256 ?? null,
      fileSize: Number.isFinite(size) ? size : null,
    };
  }

  async downloadMedia(url: string, accessToken: string, maxBytes: number, ctx: ProviderCallContext) {
    return this.client.download(url, { ...ctx, operation: "download_media", accessToken }, maxBytes);
  }

  async listTemplates(wabaId: string, accessToken: string, ctx: ProviderCallContext) {
    const out: ProviderTemplate[] = [];
    let after: string | undefined;
    // 250 templates per unverified WABA, up to 6,000 when verified; page through all of them.
    for (let page = 0; page < 100; page++) {
      const res = await this.client.request<{
        data?: MetaTemplate[];
        paging?: { cursors?: { after?: string }; next?: string };
      }>(
        "GET",
        `/${encodeURIComponent(wabaId)}/message_templates`,
        { ...ctx, operation: "list_templates", accessToken },
        { query: { fields: TEMPLATE_FIELDS, limit: "100", ...(after ? { after } : {}) } },
      );
      out.push(...(res.data ?? []).map(toTemplate));
      after = res.paging?.next ? res.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return out;
  }

  async getTemplate(templateId: string, accessToken: string, ctx: ProviderCallContext) {
    const res = await this.client.request<MetaTemplate>(
      "GET",
      `/${encodeURIComponent(templateId)}`,
      { ...ctx, operation: "get_template", accessToken },
      { query: { fields: TEMPLATE_FIELDS } },
    );
    return toTemplate(res);
  }

  async createTemplate(wabaId: string, input: CreateTemplateInput, accessToken: string, ctx: ProviderCallContext) {
    const res = await this.client.request<{ id?: string; status?: string; category?: string }>(
      "POST",
      `/${encodeURIComponent(wabaId)}/message_templates`,
      { ...ctx, operation: "create_template", accessToken },
      {
        body: {
          name: input.name,
          language: input.language,
          category: input.category,
          parameter_format: input.parameterFormat,
          components: input.components,
        },
      },
    );
    if (!res.id) throw new Error("Meta returned no template id");
    return { id: res.id, status: res.status ?? "PENDING", category: res.category ?? null };
  }

  async deleteTemplate(
    wabaId: string,
    name: string,
    templateId: string | null,
    accessToken: string,
    ctx: ProviderCallContext,
  ) {
    await this.client.request(
      "DELETE",
      `/${encodeURIComponent(wabaId)}/message_templates`,
      { ...ctx, operation: "delete_template", accessToken },
      { query: { name, ...(templateId ? { hsm_id: templateId } : {}) } },
    );
  }
}
