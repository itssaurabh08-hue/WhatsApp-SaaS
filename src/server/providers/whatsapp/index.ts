import "server-only";
import { MetaCloudProvider } from "./meta/provider";
import type { FetchLike } from "./meta/graph-client";
import type { WhatsAppProvider } from "./types";

export interface PlatformConfig {
  appId: string;
  appSecret: string;
  configId: string;
  verifyToken: string;
  apiVersion: string;
}

/** Platform (Tech Provider) app settings, or null when WhatsApp is not configured on this server. */
export function getPlatformConfig(): PlatformConfig | null {
  const { WHATSAPP_APP_ID, WHATSAPP_APP_SECRET, WHATSAPP_CONFIG_ID, WHATSAPP_VERIFY_TOKEN } = process.env;
  if (!WHATSAPP_APP_ID || !WHATSAPP_APP_SECRET || !WHATSAPP_CONFIG_ID || !WHATSAPP_VERIFY_TOKEN) return null;
  return {
    appId: WHATSAPP_APP_ID,
    appSecret: WHATSAPP_APP_SECRET,
    configId: WHATSAPP_CONFIG_ID,
    verifyToken: WHATSAPP_VERIFY_TOKEN,
    apiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || "v25.0",
  };
}

let override: WhatsAppProvider | null = null;
let fetchOverride: FetchLike | undefined;

/** Test hook: replace the provider or the HTTP layer used by the Meta provider. */
export function setWhatsAppProviderForTests(provider: WhatsAppProvider | null, fetchImpl?: FetchLike) {
  override = provider;
  fetchOverride = fetchImpl;
}

export function getWhatsAppProvider(): WhatsAppProvider {
  if (override) return override;
  const config = getPlatformConfig();
  if (!config) throw new Error("WhatsApp is not configured on this server");
  // WHATSAPP_GRAPH_BASE_URL exists only so end-to-end tests can point at a local fake of the Graph API.
  return new MetaCloudProvider({
    ...config,
    fetch: fetchOverride,
    baseUrl: process.env.WHATSAPP_GRAPH_BASE_URL || undefined,
  });
}
