export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const SMTP_SINK_PORT = Number(process.env.E2E_SMTP_PORT ?? 2525);
export const E2E_WORKER_HEALTH_PORT = Number(process.env.E2E_WORKER_HEALTH_PORT ?? 3101);
export const FAKE_GRAPH_PORT = Number(process.env.E2E_FAKE_GRAPH_PORT ?? 2626);
export const E2E_APP_SECRET = "e2e-meta-app-secret";
export const E2E_VERIFY_TOKEN = "e2e-verify-token";
export const EMAIL_LOG = "test-results/e2e-emails.json";

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://whatsflow:whatsflow@localhost:5432/whatsflow_e2e";

export const E2E_ENV: Record<string, string> = {
  NODE_ENV: "production",
  DATABASE_URL: E2E_DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  APP_URL: `http://localhost:${E2E_PORT}`,
  AUTH_SECRET: "e2e-test-auth-secret-at-least-32-characters",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String(SMTP_SINK_PORT),
  EMAIL_FROM: "E2E <no-reply@example.com>",
  RATE_LIMIT_DISABLED: "true",
  QUEUE_PREFIX: "whatsflow-e2e",
  ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  WHATSAPP_APP_ID: "1234567890",
  WHATSAPP_APP_SECRET: E2E_APP_SECRET,
  WHATSAPP_CONFIG_ID: "555000111",
  WHATSAPP_VERIFY_TOKEN: E2E_VERIFY_TOKEN,
  WHATSAPP_GRAPH_BASE_URL: `http://127.0.0.1:${FAKE_GRAPH_PORT}`,
  LOG_LEVEL: "warn",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: "test-results/e2e-storage",
};
