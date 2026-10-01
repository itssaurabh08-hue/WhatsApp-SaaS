import { env } from "@/config/env";
import { logger } from "@/server/logging/logger";

/** Fails fast on invalid configuration instead of erroring on the first request that needs it. */
export function validateStartup() {
  const config = env();
  logger.info({ nodeEnv: config.NODE_ENV, appUrl: config.APP_URL }, "configuration validated");
}
