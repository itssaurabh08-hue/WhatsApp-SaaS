import "server-only";
import pino from "pino";

/**
 * Structured JSON logger. Fields that may carry secrets are redacted globally;
 * callers should still avoid logging message bodies or tokens.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.SERVICE_NAME ?? "web" },
  redact: {
    paths: [
      "password",
      "*.password",
      "passwordHash",
      "*.passwordHash",
      "token",
      "*.token",
      "accessToken",
      "*.accessToken",
      "authorization",
      "*.authorization",
      "cookie",
      "*.cookie",
    ],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;
