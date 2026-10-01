import { env } from "@/config/env";
import { isEncryptionConfigured } from "@/server/crypto/secrets";
import { logger } from "@/server/logging/logger";

const WHATSAPP_VARS = [
  "WHATSAPP_APP_ID",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_CONFIG_ID",
  "WHATSAPP_VERIFY_TOKEN",
] as const;

/** Fails fast on invalid configuration instead of erroring on the first request that needs it. */
export function validateStartup() {
  const config = env();
  const set = WHATSAPP_VARS.filter((k) => !!process.env[k]);
  if (set.length > 0 && set.length < WHATSAPP_VARS.length) {
    const missing = WHATSAPP_VARS.filter((k) => !process.env[k]);
    throw new Error(`WhatsApp is partially configured. Missing: ${missing.join(", ")}`);
  }
  const whatsappEnabled = set.length === WHATSAPP_VARS.length;
  if (whatsappEnabled && !isEncryptionConfigured()) {
    throw new Error(
      "ENCRYPTION_KEY must be set (32 bytes, base64) when WhatsApp is configured: access tokens are stored encrypted.",
    );
  }
  const storage = process.env.STORAGE_DRIVER || "local";
  if (storage !== "local" && storage !== "s3") throw new Error('STORAGE_DRIVER must be "local" or "s3"');
  if (storage === "s3" && !process.env.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
  logger.info({ nodeEnv: config.NODE_ENV, appUrl: config.APP_URL, whatsappEnabled }, "configuration validated");
}
