import { createServer, type Server } from "node:http";

/**
 * Local stand-in for graph.facebook.com used by the app server and worker during
 * E2E tests. Responses follow the documented shapes (docs/META_API_VERIFICATION.md).
 * GET /__calls returns the requests received so far, for assertions.
 */
export const E2E_WABA_ID = "102290129340398";
export const E2E_PHONE_ID = "106540352242922";
// Second account so specs that connect in parallel workspaces never share a number.
export const E2E_WABA_ID_2 = "102290129340399";
export const E2E_PHONE_ID_2 = "106540352242923";

const PHONES: Record<string, string> = { [E2E_WABA_ID]: E2E_PHONE_ID, [E2E_WABA_ID_2]: E2E_PHONE_ID_2 };
const PHONE_IDS = new Set(Object.values(PHONES));

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

const TEMPLATES = [
  {
    name: "order_update",
    parameter_format: "POSITIONAL",
    components: [{ type: "BODY", text: "Hi {{1}}, order {{2}} has shipped.", example: { body_text: [["Ana", "A1"]] } }],
    language: "en_US",
    status: "APPROVED",
    category: "UTILITY",
    id: "1001",
  },
];

export function startFakeGraph(port: number): Promise<Server> {
  const calls: RecordedRequest[] = [];
  let counter = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      try {
        body = raw && req.headers["content-type"]?.includes("json") ? JSON.parse(raw) : raw ? "<binary>" : null;
      } catch {
        body = raw;
      }
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (path === "/__calls") return json(200, calls);
      calls.push({ method: req.method ?? "GET", path, body });

      const segments = path.split("/").filter(Boolean);
      const [first, second] = segments;
      if (req.method === "GET" && path === "/oauth/access_token") {
        return json(200, { access_token: "EAAe2etestbusinesstoken000000000000", token_type: "bearer" });
      }
      if (first && PHONES[first]) {
        const phone = PHONES[first]!;
        if (req.method === "GET" && second === "phone_numbers") {
          return json(200, {
            data: [
              {
                id: phone,
                display_phone_number: "+1 555-078-3881",
                verified_name: "Lucky Shrub",
                quality_rating: "GREEN",
              },
            ],
          });
        }
        if (second === "subscribed_apps") return json(200, { success: true });
        if (second === "message_templates") {
          if (req.method === "GET")
            return json(200, { data: TEMPLATES, paging: { cursors: { before: "a", after: "b" } } });
          if (req.method === "POST")
            return json(200, { id: String(900000 + ++counter), status: "PENDING", category: "UTILITY" });
          if (req.method === "DELETE") return json(200, { success: true });
        }
      }
      if (first && PHONE_IDS.has(first)) {
        if (second === "register") return json(200, { success: true });
        if (req.method === "POST" && second === "messages") {
          const to = (body as { to?: string } | null)?.to ?? "";
          return json(200, {
            messaging_product: "whatsapp",
            contacts: [{ input: to, wa_id: to.replace(/\D/g, "") }],
            messages: [{ id: `wamid.e2e${++counter}`, message_status: "accepted" }],
          });
        }
        if (req.method === "POST" && second === "media") return json(200, { id: String(700000 + ++counter) });
        if (req.method === "GET" && !second) {
          return json(200, {
            id: first,
            display_phone_number: "+1 555-078-3881",
            verified_name: "Lucky Shrub",
            quality_rating: "GREEN",
            name_status: "APPROVED",
            code_verification_status: "VERIFIED",
            whatsapp_business_manager_messaging_limit: "TIER_250",
          });
        }
      }
      json(400, { error: { message: `fake graph: no handler for ${req.method} ${path}`, code: 100 } });
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
