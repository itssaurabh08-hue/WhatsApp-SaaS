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
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
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
