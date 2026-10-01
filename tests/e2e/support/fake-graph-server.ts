import { createServer, type Server } from "node:http";

/**
 * Local stand-in for graph.facebook.com used by the app server during E2E
 * tests. Responses follow the documented shapes (docs/META_API_VERIFICATION.md).
 */
export const E2E_WABA_ID = "102290129340398";
export const E2E_PHONE_ID = "106540352242922";

export function startFakeGraph(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && path === "/oauth/access_token") {
      return json(200, { access_token: "EAAe2etestbusinesstoken000000000000", token_type: "bearer" });
    }
    if (req.method === "GET" && path === `/${E2E_WABA_ID}/phone_numbers`) {
      return json(200, {
        data: [
          {
            id: E2E_PHONE_ID,
            display_phone_number: "+1 555-078-3881",
            verified_name: "Lucky Shrub",
            quality_rating: "GREEN",
          },
        ],
      });
    }
    if (path === `/${E2E_WABA_ID}/subscribed_apps` || path === `/${E2E_PHONE_ID}/register`)
      return json(200, { success: true });
    if (req.method === "GET" && path === `/${E2E_PHONE_ID}`) {
      return json(200, {
        id: E2E_PHONE_ID,
        display_phone_number: "+1 555-078-3881",
        verified_name: "Lucky Shrub",
        quality_rating: "GREEN",
        name_status: "APPROVED",
        code_verification_status: "VERIFIED",
        whatsapp_business_manager_messaging_limit: "TIER_250",
      });
    }
    json(400, { error: { message: `fake graph: no handler for ${req.method} ${path}`, code: 100 } });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
