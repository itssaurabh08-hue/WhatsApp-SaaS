const LIMITS: Record<string, string> = {
  TIER_50: "50 customers per 24 hours",
  TIER_250: "250 customers per 24 hours",
  TIER_2K: "2,000 customers per 24 hours",
  TIER_10K: "10,000 customers per 24 hours",
  TIER_100K: "100,000 customers per 24 hours",
  TIER_UNLIMITED: "Unlimited",
  TIER_NOT_SET: "Not set yet (no messages sent)",
};

/** Human-readable messaging limit (WA/messaging-limits). Unknown values are shown as-is. */
export function formatMessagingLimit(value: string | null | undefined) {
  if (!value) return "Unknown";
  return LIMITS[value] ?? value;
}

const QUALITY: Record<string, { label: string; tone: "success" | "warning" | "destructive" | "secondary" }> = {
  GREEN: { label: "High", tone: "success" },
  YELLOW: { label: "Medium", tone: "warning" },
  RED: { label: "Low", tone: "destructive" },
  NA: { label: "Not rated yet", tone: "secondary" },
};

export function formatQuality(value: string | null | undefined) {
  return QUALITY[value ?? ""] ?? { label: value ?? "Unknown", tone: "secondary" as const };
}

export const ACCOUNT_STATUS: Record<
  string,
  { label: string; tone: "success" | "warning" | "destructive" | "secondary" }
> = {
  CONNECTED: { label: "Connected", tone: "success" },
  PENDING_SETUP: { label: "Setup not finished", tone: "warning" },
  NEEDS_RECONNECT: { label: "Needs reconnecting", tone: "destructive" },
  RESTRICTED: { label: "Restricted by Meta", tone: "destructive" },
  DISCONNECTED: { label: "Disconnected", tone: "secondary" },
};
