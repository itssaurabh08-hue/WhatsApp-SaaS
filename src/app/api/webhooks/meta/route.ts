import { getPlatformConfig } from "@/server/providers/whatsapp";
import { verifyMetaHandshake } from "@/server/providers/whatsapp/meta/webhooks";
import { ingestMetaWebhook } from "@/server/webhooks/meta-ingest";

export const dynamic = "force-dynamic";

/** Meta webhook verification handshake (WA/webhooks/create-webhook-endpoint). */
export async function GET(request: Request) {
  const config = getPlatformConfig();
  if (!config) return new Response("Not configured", { status: 404 });
  const challenge = verifyMetaHandshake(new URL(request.url).searchParams, config.verifyToken);
  if (challenge === null) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

/** Webhook deliveries. Signature is checked against the raw body before anything else. */
export async function POST(request: Request) {
  const config = getPlatformConfig();
  if (!config) return new Response("Not configured", { status: 404 });
  const raw = await request.text();
  if (raw.length > 5 * 1024 * 1024) return new Response("Payload too large", { status: 413 });
  const result = await ingestMetaWebhook(raw, request.headers.get("x-hub-signature-256"), config.appSecret);
  return new Response(result.status === 200 ? "OK" : "Error", { status: result.status });
}
