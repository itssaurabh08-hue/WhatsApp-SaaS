/**
 * In-memory stand-in for the Graph API, shaped after the documented responses
 * in docs/META_API_VERIFICATION.md. Each handler matches method + path.
 */
export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  authorization: string | null;
}

type Handler = (call: RecordedCall) => { status?: number; json?: unknown; text?: string };

export function metaError(code: number, message = "error", status = 400) {
  return { status, json: { error: { message, type: "OAuthException", code, fbtrace_id: "TRACE123" } } };
}

export class FakeMeta {
  readonly calls: RecordedCall[] = [];
  private handlers: { method: string; pattern: RegExp; handler: Handler }[] = [];

  on(method: string, pattern: RegExp, handler: Handler) {
    this.handlers.unshift({ method, pattern, handler });
    return this;
  }

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    const call: RecordedCall = {
      method: init?.method ?? "GET",
      path,
      query: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body instanceof FormData ? init.body : null,
      authorization: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
    };
    this.calls.push(call);
    const match = this.handlers.find((h) => h.method === call.method && h.pattern.test(path));
    if (!match)
      return new Response(JSON.stringify({ error: { message: `no fake for ${call.method} ${path}`, code: 100 } }), {
        status: 400,
      });
    const res = match.handler(call);
    return new Response(res.text ?? JSON.stringify(res.json ?? {}), { status: res.status ?? 200 });
  };

  callsTo(method: string, pattern: RegExp) {
    return this.calls.filter((c) => c.method === method && pattern.test(c.path));
  }
}

export const WABA_ID = "102290129340398";
export const PHONE_ID = "106540352242922";
export const BUSINESS_TOKEN = "EAAtestbusinesstoken1234567890abcdef";

/** A fake that accepts the happy-path onboarding for WABA_ID / PHONE_ID. */
export function happyMeta() {
  return new FakeMeta()
    .on("GET", /^\/oauth\/access_token$/, () => ({ json: { access_token: BUSINESS_TOKEN, token_type: "bearer" } }))
    .on("GET", new RegExp(`^/${WABA_ID}/phone_numbers$`), () => ({
      json: {
        data: [
          {
            id: PHONE_ID,
            display_phone_number: "+1 555-078-3881",
            verified_name: "Lucky Shrub",
            quality_rating: "GREEN",
          },
        ],
      },
    }))
    .on("POST", new RegExp(`^/${WABA_ID}/subscribed_apps$`), () => ({ json: { success: true } }))
    .on("DELETE", new RegExp(`^/${WABA_ID}/subscribed_apps$`), () => ({ json: { success: true } }))
    .on("POST", new RegExp(`^/${PHONE_ID}/register$`), () => ({ json: { success: true } }))
    .on("GET", new RegExp(`^/${PHONE_ID}$`), () => ({
      json: {
        id: PHONE_ID,
        display_phone_number: "+1 555-078-3881",
        verified_name: "Lucky Shrub",
        quality_rating: "GREEN",
        name_status: "APPROVED",
        code_verification_status: "VERIFIED",
        whatsapp_business_manager_messaging_limit: "TIER_250",
        throughput: { level: "STANDARD" },
      },
    }));
}

let wamidCounter = 0;

/** Adds messaging, media and template endpoints to a fake (documented response shapes). */
export function withMessaging(fake: FakeMeta) {
  return fake
    .on("POST", new RegExp(`^/${PHONE_ID}/messages$`), (call) => ({
      json: {
        messaging_product: "whatsapp",
        contacts: [{ input: (call.body as { to: string }).to, wa_id: "16505551234" }],
        messages: [{ id: `wamid.fake${++wamidCounter}`, message_status: "accepted" }],
      },
    }))
    .on("POST", new RegExp(`^/${PHONE_ID}/media$`), () => ({ json: { id: "1037543291543636" } }))
    .on("GET", /^\/media123$/, () => ({
      json: {
        messaging_product: "whatsapp",
        url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123",
        mime_type: "image/jpeg",
        sha256: "abc",
        file_size: "4",
        id: "media123",
      },
    }))
    .on("GET", /^\/whatsapp_business\/attachments\/$/, () => ({ text: "JPEG" }))
    .on("POST", new RegExp(`^/${WABA_ID}/message_templates$`), () => ({
      json: { id: "546151681022936", status: "PENDING", category: "UTILITY" },
    }))
    .on("GET", new RegExp(`^/${WABA_ID}/message_templates$`), () => ({
      json: {
        data: [
          {
            name: "order_update",
            parameter_format: "POSITIONAL",
            components: [
              { type: "BODY", text: "Hi {{1}}, order {{2}} has shipped.", example: { body_text: [["Ana", "A1"]] } },
            ],
            language: "en_US",
            status: "APPROVED",
            category: "UTILITY",
            id: "1001",
          },
          {
            name: "spring_sale",
            parameter_format: "NAMED",
            components: [
              { type: "BODY", text: "Hi {{first_name}}, our sale starts now!" },
              { type: "BUTTONS", buttons: [{ type: "URL", text: "Shop", url: "https://shop.example.com/{{1}}" }] },
            ],
            language: "en",
            status: "APPROVED",
            category: "MARKETING",
            id: "1002",
          },
        ],
        paging: { cursors: { before: "a", after: "b" } },
      },
    }))
    .on("DELETE", new RegExp(`^/${WABA_ID}/message_templates$`), () => ({ json: { success: true } }));
}
