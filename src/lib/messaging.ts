/**
 * Customer service window (WA/messages/send-messages#customer-service-windows):
 * a WhatsApp user's message starts or resets a 24-hour window. Inside it any
 * message type may be sent; outside it only approved templates.
 */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowExpiresAt(lastInboundAt: Date | string | null | undefined): Date | null {
  if (!lastInboundAt) return null;
  return new Date(new Date(lastInboundAt).getTime() + CUSTOMER_SERVICE_WINDOW_MS);
}

export function isWindowOpen(lastInboundAt: Date | string | null | undefined, now = new Date()): boolean {
  const expires = windowExpiresAt(lastInboundAt);
  return !!expires && expires.getTime() > now.getTime();
}

/** "3h 12m" style remaining time, or null when closed. */
export function windowRemaining(lastInboundAt: Date | string | null | undefined, now = new Date()) {
  const expires = windowExpiresAt(lastInboundAt);
  if (!expires) return null;
  const ms = expires.getTime() - now.getTime();
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export const MESSAGE_STATUS_LABELS: Record<string, string> = {
  QUEUED: "Queued",
  SENDING: "Sending",
  ACCEPTED: "Accepted by WhatsApp",
  SENT: "Sent",
  DELIVERED: "Delivered",
  READ: "Read",
  FAILED: "Failed",
  RECEIVED: "Received",
};

/** Forward-only order of outbound statuses. FAILED is handled separately. */
export const STATUS_RANK: Record<string, number> = {
  QUEUED: 0,
  SENDING: 1,
  ACCEPTED: 2,
  SENT: 3,
  DELIVERED: 4,
  READ: 5,
};

/** Short preview for conversation lists. */
export function messagePreview(type: string, body: string | null | undefined): string {
  const text = body?.replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 120);
  const labels: Record<string, string> = {
    image: "Photo",
    video: "Video",
    audio: "Audio",
    document: "Document",
    sticker: "Sticker",
    location: "Location",
    contacts: "Contact card",
    reaction: "Reaction",
    unsupported: "Unsupported message",
  };
  return labels[type] ?? "Message";
}
