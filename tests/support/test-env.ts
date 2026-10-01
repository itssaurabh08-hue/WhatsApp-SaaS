/** Environment for integration tests. TEST_DATABASE_URL must point at a disposable database. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://whatsflow:whatsflow@localhost:5432/whatsflow_test";

export function applyTestEnv() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    AUTH_SECRET: "integration-test-auth-secret-at-least-32-chars",
    APP_URL: "http://localhost:3000",
    EMAIL_PROVIDER: "memory",
    RATE_LIMIT_DISABLED: "true",
    LOG_LEVEL: "silent",
    QUEUE_PREFIX: "whatsflow-test",
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    WHATSAPP_APP_ID: "1234567890",
    WHATSAPP_APP_SECRET: "test-app-secret",
    WHATSAPP_CONFIG_ID: "987654321",
    WHATSAPP_VERIFY_TOKEN: "test-verify-token",
    WHATSAPP_GRAPH_API_VERSION: "v25.0",
  });
}
