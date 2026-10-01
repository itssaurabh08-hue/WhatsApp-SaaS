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
  });
}
