import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedWebhookChange } from "../types";

/**
 * Verifies X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app
 * secret) in constant time. See WA/webhooks/create-webhook-endpoint.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const received = Buffer.from(header.slice(7), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** GET verification handshake. Returns the challenge to echo, or null if invalid. */
export function verifyMetaHandshake(params: URLSearchParams, verifyToken: string): string | null {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode !== "subscribe" || !token || !challenge) return null;
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return challenge;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

interface MetaWebhookBody {
  object?: string;
  entry?: { id?: string; changes?: { field?: string; value?: Record<string, unknown> }[] }[];
}

/**
 * Splits a delivery into one change per message / status / other change so
 * each can be deduplicated and processed independently. Meta may batch
 * differently on retries, so keys never depend on batch position.
 */
export function normalizeMetaWebhook(body: unknown): NormalizedWebhookChange[] {
  const b = body as MetaWebhookBody;
  if (!b || b.object !== "whatsapp_business_account" || !Array.isArray(b.entry)) return [];
  const out: NormalizedWebhookChange[] = [];
  for (const entry of b.entry) {
    const businessAccountId = typeof entry.id === "string" ? entry.id : null;
    for (const change of entry.changes ?? []) {
      const field = typeof change.field === "string" ? change.field : "unknown";
      const value = change.value ?? {};
      const metadata = value.metadata as { phone_number_id?: string } | undefined;
      const phoneNumberId = typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : null;
      const base = { field, businessAccountId, phoneNumberId };
      const messages = Array.isArray(value.messages) ? (value.messages as Record<string, unknown>[]) : [];
      const statuses = Array.isArray(value.statuses) ? (value.statuses as Record<string, unknown>[]) : [];
      if (field === "messages" && (messages.length > 0 || statuses.length > 0)) {
        const { messages: _m, statuses: _s, ...rest } = value;
        for (const m of messages) {
          out.push({
            ...base,
            dedupeKey: `msg:${String(m.id ?? sha256(JSON.stringify(m)))}`,
            value: { ...rest, messages: [m] },
          });
        }
        for (const s of statuses) {
          const key = `status:${String(s.id)}:${String(s.status)}:${String(s.timestamp ?? "")}`;
          out.push({ ...base, dedupeKey: key, value: { ...rest, statuses: [s] } });
        }
        continue;
      }
      out.push({ ...base, dedupeKey: `${field}:${businessAccountId ?? ""}:${sha256(JSON.stringify(value))}`, value });
    }
  }
  return out;
}
